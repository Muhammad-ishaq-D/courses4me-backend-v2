const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const User = require('../models/User');
const notifyAdmins = require('../utils/notifyAdmins');

// ─── Google Strategy ─────────────────────────────────────────────────────────
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || 'placeholder',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder',
      callbackURL: '/api/auth/google/callback',
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const profileImage = profile.photos?.[0]?.value || '';

        // 1. Find by Google ID first (returning user)
        let user = await User.findOne({ googleId: profile.id });
        if (user) {
          return done(null, user);
        }

        // 2. Find by email — this means they registered with email/password before
        if (email) {
          user = await User.findOne({ email: email.toLowerCase().trim() });
          if (user) {
            // Link Google provider to the existing account
            user.googleId = profile.id;
            if (!user.profileImage && profileImage) user.profileImage = profileImage;
            await user.save({ validateBeforeSave: false });
            return done(null, user);
          }
        }

        // 3. Brand new user — create account
        user = await User.create({
          googleId: profile.id,
          name: profile.displayName || 'Google User',
          email: email ? email.toLowerCase().trim() : `google_${profile.id}@noemail.com`,
          profileImage,
        });

        await notifyAdmins({
          settingKey: 'userRegistration',
          title: 'New User Registration',
          message: `${user.name} (${user.email}) just signed up via Google.`,
          type: 'user'
        });

        return done(null, user);
      } catch (err) {
        console.error('[Passport Google] Error:', err);
        return done(err, null);
      }
    }
  )
);

// ─── Facebook Strategy ────────────────────────────────────────────────────────
passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID || 'placeholder',
      clientSecret: process.env.FACEBOOK_APP_SECRET || 'placeholder',
      callbackURL: '/api/auth/facebook/callback',
      profileFields: ['id', 'displayName', 'photos', 'email'],
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const profileImage = profile.photos?.[0]?.value || '';

        // 1. Find by Facebook ID first (returning user)
        let user = await User.findOne({ facebookId: profile.id });
        if (user) {
          return done(null, user);
        }

        // 2. Find by email — link Facebook to existing account
        if (email) {
          user = await User.findOne({ email: email.toLowerCase().trim() });
          if (user) {
            user.facebookId = profile.id;
            if (!user.profileImage && profileImage) user.profileImage = profileImage;
            await user.save({ validateBeforeSave: false });
            return done(null, user);
          }
        }

        // 3. Brand new user — create account
        // Facebook may not provide email (user denied permission), use a placeholder
        const fallbackEmail = email
          ? email.toLowerCase().trim()
          : `facebook_${profile.id}@noemail.com`;

        user = await User.create({
          facebookId: profile.id,
          name: profile.displayName || 'Facebook User',
          email: fallbackEmail,
          profileImage,
        });

        await notifyAdmins({
          settingKey: 'userRegistration',
          title: 'New User Registration',
          message: `${user.name} (${user.email}) just signed up via Facebook.`,
          type: 'user'
        });

        return done(null, user);
      } catch (err) {
        console.error('[Passport Facebook] Error:', err);
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;

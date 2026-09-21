const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const UserModel = require('../models/userModel');
const notifyAdmins = require('../utils/notifyAdmins');
const logger = require('../utils/logger');

/**
 * Shared social sign-in resolution:
 *   1. returning user (provider id already linked)          -> that user
 *   2. same email registered with password / other provider -> link provider
 *   3. brand-new                                            -> create customer
 * Returns the DB row; authRoutes signs the JWT from it.
 */
async function resolveSocialUser({ provider, providerId, email, displayName, profileImage }) {
  const idColumn = provider === 'google' ? 'googleId' : 'facebookId';
  const findByProviderId = provider === 'google' ? UserModel.findByGoogleId : UserModel.findByFacebookId;

  let user = await findByProviderId(providerId);
  if (user) return user;

  const normalizedEmail = email ? email.toLowerCase().trim() : null;
  if (normalizedEmail) {
    user = await UserModel.findByEmail(normalizedEmail);
    if (user) {
      const patch = { [idColumn]: providerId };
      if (!user.profile_image && profileImage) patch.profileImage = profileImage;
      await UserModel.update(user.id, patch);
      return UserModel.findById(user.id);
    }
  }

  // The provider may withhold the email (user denied permission): use a placeholder
  const finalEmail = normalizedEmail || `${provider}_${providerId}@noemail.com`;
  const name = displayName || (provider === 'google' ? 'Google User' : 'Facebook User');
  const id = await UserModel.create({
    [idColumn]: providerId,
    name,
    email: finalEmail,
    profileImage: profileImage || null,
    role: 'customer'
  });
  await notifyAdmins({
    settingKey: 'userRegistration',
    title: 'New User Registration',
    message: `${name} (${finalEmail}) just signed up via ${provider === 'google' ? 'Google' : 'Facebook'}.`,
    type: 'user'
  });

  return UserModel.findById(id);
}

const verify = (provider) => async (accessToken, refreshToken, profile, done) => {
  try {
    const user = await resolveSocialUser({
      provider,
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName,
      profileImage: profile.photos?.[0]?.value || ''
    });
    return done(null, user);
  } catch (err) {
    logger.error(`[Passport ${provider}] Error:`, err);
    return done(err, null);
  }
};

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || 'placeholder',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder',
  callbackURL: '/api/auth/google/callback',
  proxy: true
}, verify('google')));

passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID || 'placeholder',
  clientSecret: process.env.FACEBOOK_APP_SECRET || 'placeholder',
  callbackURL: '/api/auth/facebook/callback',
  profileFields: ['id', 'displayName', 'photos', 'email'],
  proxy: true
}, verify('facebook')));

// Stateless JWT flow (session: false); kept for passport's API completeness.
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    done(null, await UserModel.findById(id));
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
module.exports.resolveSocialUser = resolveSocialUser;

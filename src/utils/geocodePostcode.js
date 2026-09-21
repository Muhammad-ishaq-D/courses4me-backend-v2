/**
 * Resolve UK postcode coordinates via postcodes.io (free, no API key required).
 * @see https://postcodes.io/docs
 */
async function geocodePostcode(postcode) {
    const normalized = postcode.replace(/\s+/g, '').toUpperCase();
    if (!normalized) {
        throw new Error('Postcode is required for geocoding');
    }

    const response = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(normalized)}`
    );
    const data = await response.json();

    if (data.status !== 200 || !data.result) {
        throw new Error(`Could not find coordinates for postcode "${postcode.trim()}"`);
    }

    const result = data.result;

    return {
        latitude: result.latitude,
        longitude: result.longitude,
        postcode: result.postcode,
        adminDistrict: result.admin_district,
        adminWard: result.admin_ward,
        parish: result.parish,
        region: result.region,
        country: result.country
    };
}

/**
 * Check whether a postcode's area metadata plausibly matches the location title.
 */
function postcodeMatchesLocationName(geocodeResult, locationName) {
    const name = locationName?.trim().toLowerCase();
    if (!name) {
        return true;
    }

    const searchableFields = [
        geocodeResult.adminDistrict,
        geocodeResult.adminWard,
        geocodeResult.parish,
        geocodeResult.region,
        geocodeResult.country
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (searchableFields.includes(name)) {
        return true;
    }

    const tokens = name.split(/[\s,./-]+/).filter((token) => token.length > 2);
    return tokens.some((token) => searchableFields.includes(token));
}

function formatPostcodeArea(geocodeResult) {
    return [geocodeResult.adminDistrict, geocodeResult.region]
        .filter(Boolean)
        .join(', ');
}

/**
 * Attach latitude/longitude to each course location from its postcode.
 */
async function enrichLocationsWithCoordinates(locations) {
    if (!locations || !Array.isArray(locations)) {
        return locations;
    }

    return Promise.all(
        locations.map(async (loc) => {
            const location = { ...loc };

            if (!location.postcode?.trim()) {
                throw new Error(
                    `Location "${location.name || 'Untitled'}" is missing a postcode`
                );
            }

            const geocodeResult = await geocodePostcode(location.postcode);

            if (!postcodeMatchesLocationName(geocodeResult, location.name)) {
                const area = formatPostcodeArea(geocodeResult) || geocodeResult.postcode;
                throw new Error(
                    `Postcode "${geocodeResult.postcode}" is in ${area}, which does not match location "${location.name}". Please use the correct postcode for this venue.`
                );
            }

            location.postcode = geocodeResult.postcode;
            location.latitude = geocodeResult.latitude;
            location.longitude = geocodeResult.longitude;

            return location;
        })
    );
}

module.exports = {
    geocodePostcode,
    postcodeMatchesLocationName,
    enrichLocationsWithCoordinates
};

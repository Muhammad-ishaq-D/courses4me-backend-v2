const { enrichLocationsWithCoordinates } = require('../src/utils/geocodePostcode');

describe('enrichLocationsWithCoordinates', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const respond = (body) => { global.fetch = jest.fn(async () => ({ json: async () => body })); };

  it('fills in the coordinates and normalised postcode', async () => {
    respond({ status: 200, result: { latitude: 51.5, longitude: -0.1, postcode: 'SW1A 1AA', admin_district: 'Westminster', region: 'London', country: 'England' } });
    const [loc] = await enrichLocationsWithCoordinates([{ name: 'London', postcode: 'sw1a1aa' }]);
    expect(loc).toMatchObject({ postcode: 'SW1A 1AA', latitude: 51.5, longitude: -0.1 });
  });

  it('rejects an unknown postcode as a 400', async () => {
    respond({ status: 404, error: 'Postcode not found' });
    await expect(enrichLocationsWithCoordinates([{ name: 'London', postcode: 'ZZ99 9ZZ' }]))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Could not find coordinates') });
  });

  it('rejects a postcode outside the named location as a 400', async () => {
    respond({ status: 200, result: { latitude: 53.4, longitude: -2.2, postcode: 'M1 1AA', admin_district: 'Manchester', region: 'North West', country: 'England' } });
    await expect(enrichLocationsWithCoordinates([{ name: 'Birmingham', postcode: 'M1 1AA' }]))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('does not match location') });
  });

  it('reports postcodes.io being unreachable as a 400', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(enrichLocationsWithCoordinates([{ name: 'London', postcode: 'SW1A 1AA' }]))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

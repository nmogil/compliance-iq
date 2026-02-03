import { JurisdictionResult } from '../query/types';

/**
 * Geocoding Service
 *
 * Converts user addresses into jurisdiction arrays for Pinecone filtering.
 * Uses Geocodio API to resolve addresses to federal, state, county, and municipal jurisdictions.
 */

const GEOCODIO_BASE_URL = 'https://api.geocod.io/v1.9/geocode';
const GEOCODIO_FIELDS = 'cd119,stateleg,census';

/**
 * Geocode an address to extract jurisdiction identifiers.
 *
 * Returns an array of jurisdiction identifiers for Pinecone filtering:
 * - Always includes "US" (federal)
 * - Adds state code if resolved (e.g., "TX")
 * - Adds county as "TX-{fips}" from census data (e.g., "TX-48201")
 * - Adds city as "TX-{city-normalized}" where city is lowercase with hyphens (e.g., "TX-houston")
 *
 * Gracefully handles errors by returning federal-only fallback.
 *
 * @param address - Street address to geocode
 * @param apiKey - Geocodio API key
 * @returns JurisdictionResult with jurisdiction array and details
 */
export async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<JurisdictionResult> {
  try {
    const url = `${GEOCODIO_BASE_URL}?q=${encodeURIComponent(address)}&fields=${GEOCODIO_FIELDS}&api_key=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(
        `Geocodio API error: ${response.status} ${response.statusText}`
      );
      return getFallbackJurisdictions();
    }

    const data = await response.json();

    // No results found
    if (!data.results || data.results.length === 0) {
      console.warn('Geocodio returned no results for address:', address);
      return getFallbackJurisdictions();
    }

    // Extract best match
    const result = data.results[0];
    const jurisdictions: string[] = ['US']; // Always include federal

    // State
    const state = result.address_components?.state;
    if (state) {
      jurisdictions.push(state);
    }

    // County (from census FIPS code)
    const countyFips = result.fields?.census?.county_fips;
    let county: { name: string; fips: string } | undefined;
    if (state && countyFips) {
      jurisdictions.push(`${state}-${countyFips}`);
      county = {
        name: result.fields?.census?.county_name || 'Unknown County',
        fips: countyFips,
      };
    }

    // City (normalized)
    const cityName = result.address_components?.city;
    if (state && cityName) {
      const cityId = normalizeCity(cityName);
      jurisdictions.push(`${state}-${cityId}`);
    }

    return {
      jurisdictions,
      state,
      county,
      city: cityName,
      raw: data,
    };
  } catch (error) {
    console.error('Geocoding error:', error);
    return getFallbackJurisdictions();
  }
}

/**
 * Normalize city name for jurisdiction identifier.
 *
 * Converts city name to lowercase, replaces spaces with hyphens,
 * and removes special characters.
 *
 * @param city - City name (e.g., "Houston", "Fort Worth")
 * @returns Normalized city identifier (e.g., "houston", "fort-worth")
 */
function normalizeCity(city: string): string {
  return city
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, ''); // Remove special characters
}

/**
 * Get fallback jurisdictions when geocoding fails or no address provided.
 *
 * Returns federal-only jurisdiction array to ensure queries can still proceed.
 *
 * @returns JurisdictionResult with federal-only jurisdiction
 */
export function getFallbackJurisdictions(): JurisdictionResult {
  return {
    jurisdictions: ['US'],
    state: undefined,
    county: undefined,
    city: undefined,
    raw: {},
  };
}

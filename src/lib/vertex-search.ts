import { GoogleAuth } from 'google-auth-library';
import path from 'path';

const PROJECT_ID = process.env.VERTEX_PROJECT_ID || 'waifu100-search';
const APP_ID = process.env.VERTEX_APP_ID;
const LOCATION = 'global';
const COLLECTION = 'default_collection';

export interface VertexImageResult {
  url: string;
  thumbnail?: string;
  title: string;
  sourcePage: string;
}

export async function searchVertexAI(query: string): Promise<VertexImageResult[]> {
  try {
    if (!APP_ID) {
      console.warn('Vertex AI: Missing VERTEX_APP_ID in .env');
      return [];
    }

    const keyFile = path.join(process.cwd(), 'google-service-account.json');
    if (!process.env.VERTEX_APP_ID) {
        // Double check specifically for the variable being loaded
        console.warn("Env var VERTEX_APP_ID is undefined. Restart server?");
    }

    const auth = new GoogleAuth({
      keyFile,
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });

    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    // Use ENGINES endpoint for Search Apps
    const endpoint = `https://discoveryengine.googleapis.com/v1beta/projects/${PROJECT_ID}/locations/${LOCATION}/collections/${COLLECTION}/engines/${APP_ID}/servingConfigs/default_search:search`;

    console.log(`Vertex Engine Searching: ${query}`);
    console.log(`Endpoint: .../engines/${APP_ID}/...`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: query,
        pageSize: 10
      })
    });

    if (!response.ok) {
      console.error(`Vertex API Error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error(text);
      return [];
    }

    const data = await response.json();
    console.log("DEBUG: Full Response Keys:", Object.keys(data));
    console.log("DEBUG: Results Count:", data.results?.length ?? 0);

    // DEBUG: Log the structure to find where images are hidden
    if (data.results && data.results.length > 0) {
       console.log("DEBUG VERTEX STRUCTURE:", JSON.stringify(data.results[0], null, 2));
    }

    const results: VertexImageResult[] = [];

    if (data.results) {
      for (const item of data.results) {
        // Vertex AI Search structure for website data
        const doc = item.document?.derivedStructData || {};
        
        let imageUrl = '';
        if (doc.pagemap?.cse_image?.[0]?.src) {
          imageUrl = doc.pagemap.cse_image[0].src;
        } else if (doc.pagemap?.og_image?.[0]) {
           imageUrl = doc.pagemap.og_image[0];
        }

        if (imageUrl) {
          results.push({
            url: imageUrl,
            thumbnail: imageUrl,
            title: doc.title || 'Result',
            sourcePage: doc.link || doc.url
          });
        }
      }
    }

    console.log(`Vertex found ${results.length} images`);
    return results;

  } catch (error) {
    console.error('Vertex Search Exception:', error);
    return [];
  }
}

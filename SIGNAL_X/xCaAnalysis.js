import axios from "axios";
import dotenv from "dotenv";

dotenv.config({ path: "C:\\Users\\ClawdeBot\\AI_WORKSPACE\\api.env" });

const X_BEARER_TOKEN = process.env.Bearer_Token;
const X_API_BASE = "https://api.twitter.com/2";

if (!X_BEARER_TOKEN) {
  throw new Error("X Bearer Token not found in api.env");
}

/**
 * Search for tweets mentioning a CA
 */
async function searchTweetsWithCA(ca, limit = 10) {
  try {
    const response = await axios.get(`${X_API_BASE}/tweets/search/recent`, {
      params: {
        query: ca,
        max_results: Math.min(limit, 100),
        "tweet.fields": "author_id,created_at,public_metrics",
        "user.fields": "username,public_metrics,description",
        expansions: "author_id",
      },
      headers: {
        Authorization: `Bearer ${X_BEARER_TOKEN}`,
      },
    });

    return response.data;
  } catch (error) {
    console.error("X API Error:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function analyzeCa() {
  const args = process.argv.slice(2);
  const ca = args[0];
  const limit = parseInt(args[1]) || 10;

  if (!ca) {
    console.log("Usage: node xCaAnalysis.js <contract_address> [limit]");
    console.log("Example: node xCaAnalysis.js 0xB964cA8757B0d64c50B0da17f0150563139361aC 20");
    process.exit(1);
  }

  const caAddress = ca.toLowerCase();

  if (!caAddress.match(/^0x[a-f0-9]{40}$/i)) {
    console.error("Invalid contract address. Must be 0x + 40 hex chars");
    process.exit(1);
  }

  if (limit < 1 || limit > 100) {
    console.error("Limit must be between 1-100");
    process.exit(1);
  }

  try {
    console.log(`\n🔍 Searching for tweets mentioning ${caAddress}...`);
    const searchResults = await searchTweetsWithCA(caAddress, limit);

    if (!searchResults.data || searchResults.data.length === 0) {
      console.log("\n❌ No tweets found.\n");
      process.exit(0);
    }

    // Build user map
    const userMap = {};
    if (searchResults.includes?.users) {
      searchResults.includes.users.forEach((user) => {
        userMap[user.id] = user;
      });
    }

    // Format and display
    const tweets = searchResults.data.map((tweet) => {
      const author = userMap[tweet.author_id] || {};
      return {
        tweet_id: tweet.id,
        message: tweet.text,
        tweet_url: `https://twitter.com/i/web/status/${tweet.id}`,
        account: author.username || "unknown",
        follower_count: author.public_metrics?.followers_count || 0,
        bio: author.description || "No bio",
        created_at: tweet.created_at,
      };
    });

    console.log(`\n✅ Found ${tweets.length} tweets:\n`);
    console.log(JSON.stringify(tweets, null, 2));
    console.log();
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

analyzeCa();

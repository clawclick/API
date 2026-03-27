import axios from "axios";
import dotenv from "dotenv";

dotenv.config({ path: "C:\\Users\\ClawdeBot\\AI_WORKSPACE\\api.env" });

const X_BEARER_TOKEN = process.env.Bearer_Token;
const X_API_BASE = "https://api.twitter.com/2";

if (!X_BEARER_TOKEN) {
  throw new Error("X Bearer Token not found in api.env");
}

// Store last seen tweet ID to avoid duplicates
let lastTweetId = null;

/**
 * Extract contract addresses from text (0x... pattern)
 */
function extractContractAddresses(text) {
  const caRegex = /0x[a-fA-F0-9]{40}/g;
  return text.match(caRegex) || [];
}

/**
 * Get user ID from username
 */
async function getUserIdFromUsername(username) {
  try {
    const response = await axios.get(`${X_API_BASE}/users/by/username/${username}`, {
      headers: {
        Authorization: `Bearer ${X_BEARER_TOKEN}`,
      },
    });
    return response.data.data.id;
  } catch (error) {
    throw new Error(`User not found: ${username}`);
  }
}

/**
 * Get recent tweets from user
 */
async function getUserTweets(userId) {
  try {
    const params = {
      max_results: 10,
      "tweet.fields": "created_at,public_metrics",
      expansions: "author_id",
    };

    if (lastTweetId) {
      params.since_id = lastTweetId;
    }

    const response = await axios.get(
      `${X_API_BASE}/users/${userId}/tweets`,
      { params, headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` } }
    );

    return response.data;
  } catch (error) {
    console.error("API Error:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * Main tracker
 */
async function trackKol() {
  const args = process.argv.slice(2);
  const username = args[0];
  const interval = parseInt(args[1]) || 30000; // Default 30s

  if (!username) {
    console.log("Usage: node xkolTracker.js <twitter_username> [interval_ms]");
    console.log("Example: node xkolTracker.js elonmusk 60000");
    process.exit(1);
  }

  // Validate username format
  if (!username.match(/^[a-zA-Z0-9_]{1,15}$/)) {
    console.error("Invalid Twitter username");
    process.exit(1);
  }

  try {
    console.log(`\n🔍 Getting user ID for @${username}...`);
    const userId = await getUserIdFromUsername(username);
    console.log(`✅ Found user ID: ${userId}`);
    console.log(`🚀 Tracking @${username} for CA mentions... (checking every ${interval}ms)`);
    console.log("Press Ctrl+C to stop.\n");

    // Start polling
    setInterval(async () => {
      try {
        const tweets = await getUserTweets(userId);

        if (!tweets.data || tweets.data.length === 0) {
          console.log(`[${new Date().toISOString()}] No new tweets`);
          return;
        }

        // Process tweets (newest first)
        for (const tweet of tweets.data) {
          const cas = extractContractAddresses(tweet.text);

          if (cas.length > 0) {
            // Found CA(s) in tweet
            const notification = {
              timestamp: new Date().toISOString(),
              kol: `@${username}`,
              tweet_id: tweet.id,
              tweet_url: `https://twitter.com/${username}/status/${tweet.id}`,
              message: tweet.text,
              contract_addresses: cas,
              created_at: tweet.created_at,
            };

            console.log("\n🚨 ALERT: CA FOUND IN TWEET!");
            console.log(JSON.stringify(notification, null, 2));
            console.log();
          }

          // Update last seen ID
          if (!lastTweetId || tweet.id > lastTweetId) {
            lastTweetId = tweet.id;
          }
        }
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error:`, error.message);
      }
    }, interval);
  } catch (error) {
    console.error("Fatal Error:", error.message);
    process.exit(1);
  }
}

trackKol();

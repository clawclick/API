# X (Twitter) Social Sentiment Analysis
**Status: PAID** 💰 (X API v2 costs $100/month minimum)

## X API Options

### 1. X API v2 Basic (PAID)
**Cost**: $100/month
**Features**: 
- 10K tweets/month search
- Real-time streaming
- User lookup
- Tweet metrics

### 2. X API v2 Pro (PAID) 
**Cost**: $5,000/month
**Features**:
- 1M tweets/month
- Full search archive
- Advanced filtering

### 3. Alternative: Web Scraping (Legal Gray Area)
**Cost**: Free but risky
**Issues**: Rate limiting, IP blocking, ToS violations

## KOL & Influencer Tracking Strategy

### Target KOL Categories
```javascript
const kol_categories = {
  crypto_influencers: [
    // Major crypto influencers with >100K followers
    'elonmusk',
    'VitalikButerin', 
    'coinbase',
    'binance',
    // Add more high-impact accounts
  ],
  
  memecoin_traders: [
    // Known memecoin traders/callers
    // Research and populate this list
  ],
  
  whale_watchers: [
    // Accounts that track whale movements
    'whale_alert',
    'lookonchain',
    // Add more whale tracking accounts
  ],
  
  dex_tools: [
    'dexscreener',
    'dextools_app',
    // DEX analysis accounts
  ]
};
```

### Sentiment Analysis Functions
```javascript
class XSentimentAnalyzer {
  constructor(apiKey, apiSecret, bearerToken) {
    this.client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret, 
      accessToken: bearerToken
    });
    this.rateLimiter = new RateLimiter(300, 'hour'); // X API limits
  }

  // Search for token mentions
  async searchTokenMentions(tokenSymbol, tokenAddress, hours = 24) {
    await this.rateLimiter.wait();
    
    const query = `(${tokenSymbol} OR ${tokenAddress}) -is:retweet lang:en`;
    const recentTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    try {
      const tweets = await this.client.v2.search(query, {
        max_results: 100,
        start_time: recentTime,
        'tweet.fields': 'created_at,author_id,public_metrics,context_annotations',
        'user.fields': 'public_metrics,verified',
        expansions: 'author_id'
      });
      
      return this.analyzeTweets(tweets);
    } catch (error) {
      console.error('X API error:', error);
      return null;
    }
  }

  // Analyze tweet sentiment and influence
  analyzeTweets(tweetsResponse) {
    if (!tweetsResponse.data) {
      return {
        mention_count: 0,
        sentiment: 'neutral',
        influence_score: 0,
        top_tweets: []
      };
    }

    const tweets = tweetsResponse.data;
    const users = tweetsResponse.includes?.users || [];
    
    let totalInfluenceScore = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    const topTweets = [];

    tweets.forEach(tweet => {
      const author = users.find(u => u.id === tweet.author_id);
      if (!author) return;
      
      // Calculate influence score based on follower count and engagement
      const followerWeight = Math.min(author.public_metrics.followers_count / 1000, 100);
      const engagementScore = (
        tweet.public_metrics.retweet_count +
        tweet.public_metrics.like_count + 
        tweet.public_metrics.reply_count
      );
      
      const influenceScore = followerWeight * Math.log(1 + engagementScore);
      totalInfluenceScore += influenceScore;
      
      // Basic sentiment analysis (would use proper NLP in production)
      const sentiment = this.basicSentimentAnalysis(tweet.text);
      if (sentiment === 'positive') positiveCount++;
      else if (sentiment === 'negative') negativeCount++;
      
      // Track top influential tweets
      topTweets.push({
        text: tweet.text,
        author: author.username,
        followers: author.public_metrics.followers_count,
        engagement: engagementScore,
        influence_score: influenceScore,
        sentiment,
        url: `https://twitter.com/${author.username}/status/${tweet.id}`
      });
    });

    // Sort by influence score
    topTweets.sort((a, b) => b.influence_score - a.influence_score);

    // Calculate overall sentiment
    const totalSentimentTweets = positiveCount + negativeCount;
    let overallSentiment = 'neutral';
    
    if (totalSentimentTweets > 0) {
      const positiveRatio = positiveCount / totalSentimentTweets;
      if (positiveRatio > 0.6) overallSentiment = 'positive';
      else if (positiveRatio < 0.4) overallSentiment = 'negative';
    }

    return {
      mention_count: tweets.length,
      sentiment: overallSentiment,
      positive_ratio: totalSentimentTweets > 0 ? positiveCount / totalSentimentTweets : 0,
      influence_score: totalInfluenceScore,
      top_tweets: topTweets.slice(0, 10), // Top 10 most influential
      analysis_timestamp: Date.now()
    };
  }

  // Basic sentiment analysis (replace with proper NLP)
  basicSentimentAnalysis(text) {
    const positiveWords = ['moon', 'pump', 'bullish', 'gem', 'buy', 'hodl', 'rocket', '🚀', '💎'];
    const negativeWords = ['dump', 'rug', 'scam', 'bearish', 'sell', 'crash', 'rekt'];
    
    const lowerText = text.toLowerCase();
    
    const positiveScore = positiveWords.filter(word => lowerText.includes(word)).length;
    const negativeScore = negativeWords.filter(word => lowerText.includes(word)).length;
    
    if (positiveScore > negativeScore) return 'positive';
    else if (negativeScore > positiveScore) return 'negative';
    else return 'neutral';
  }

  // Track specific KOL mentions
  async trackKOLMentions(tokenSymbol, kolUsernames) {
    const kolMentions = [];
    
    for (const username of kolUsernames) {
      await this.rateLimiter.wait();
      
      try {
        const userTweets = await this.client.v2.userTimelineByUsername(username, {
          max_results: 50,
          'tweet.fields': 'created_at,public_metrics'
        });
        
        const relevantTweets = userTweets.data?.filter(tweet => 
          tweet.text.toLowerCase().includes(tokenSymbol.toLowerCase())
        ) || [];
        
        if (relevantTweets.length > 0) {
          kolMentions.push({
            username,
            tweet_count: relevantTweets.length,
            tweets: relevantTweets,
            latest_mention: relevantTweets[0]?.created_at
          });
        }
      } catch (error) {
        console.error(`Error fetching tweets for ${username}:`, error);
      }
    }
    
    return kolMentions;
  }

  // Complete sentiment analysis for token
  async analyzeTokenSentiment(tokenSymbol, tokenAddress) {
    const [generalSentiment, kolMentions] = await Promise.all([
      this.searchTokenMentions(tokenSymbol, tokenAddress),
      this.trackKOLMentions(tokenSymbol, kol_categories.crypto_influencers)
    ]);
    
    return {
      general_sentiment: generalSentiment,
      kol_mentions: kolMentions,
      social_score: this.calculateSocialScore(generalSentiment, kolMentions),
      timestamp: Date.now()
    };
  }

  calculateSocialScore(generalSentiment, kolMentions) {
    let score = 0;
    
    // Base sentiment score
    if (generalSentiment) {
      if (generalSentiment.sentiment === 'positive') score += 3;
      else if (generalSentiment.sentiment === 'negative') score -= 2;
      
      // Volume bonus
      if (generalSentiment.mention_count > 50) score += 2;
      else if (generalSentiment.mention_count > 20) score += 1;
      
      // Influence bonus  
      if (generalSentiment.influence_score > 1000) score += 2;
      else if (generalSentiment.influence_score > 500) score += 1;
    }
    
    // KOL mention bonus
    if (kolMentions.length > 0) score += Math.min(3, kolMentions.length);
    
    return Math.max(0, Math.min(10, score + 5)); // Scale 0-10
  }
}
```

## Alternative: Free Social Data Sources

### 1. Reddit API (Free tier available)
- r/CryptoMoonShots mentions
- r/cryptocurrency discussions
- Comment sentiment analysis

### 2. Telegram Channel Monitoring (Custom)
- Monitor popular memecoin Telegram channels
- Track mention frequency and sentiment
- Scrape or use Telegram API

### 3. Discord Monitoring (Custom)
- Key crypto Discord servers
- Bot integration for mention tracking

## Usage Example
```javascript
const sentimentAnalyzer = new XSentimentAnalyzer(API_KEY, API_SECRET, BEARER_TOKEN);

const sentiment = await sentimentAnalyzer.analyzeTokenSentiment('BASED', '0x...');

if (sentiment.social_score > 7 && sentiment.kol_mentions.length > 0) {
  console.log('🔥 Strong social momentum detected!');
}
```

## Cost Considerations
- **X API Basic**: $100/month for limited searches
- **Alternative**: Focus on free sources + manual KOL tracking
- **Hybrid**: Use X API for KOL tracking only, other sources for general sentiment

**Recommendation: Start with free alternatives, upgrade to X API if social signals prove valuable**
/*global require console Promise */

const Twit = require("twit");
const yargs = require("yargs");
const config = require("./config");
const { errors, wrapTwitterErrors } = require("./twitter-errors");
const utils = require("./utils");

const args = yargs
  .option("query", {
    alias: "q",
    description: "Search query",
    type: "string",
  })
  .option("max", {
    alias: "m",
    description: "Maximum number of tweets to get",
    type: "number",
    default: 5000,
  })
  .help()
  .alias("help", "h").argv;

const query = args.query;
const max = args.max;

const twit = new Twit({
  consumer_key: config.apiKey,
  consumer_secret: config.apiSecret,
  access_token: config.accessToken,
  access_token_secret: config.accessTokenSecret,
  strictSSL: true,
});

const getUserID = async (screen_name) => {
  try {
    const { data } = await twit.get("users/show", { screen_name });
    const { id_str: userID } = data;
    return userID;
  } catch (error) {
    console.log("Error: ", error);
    throw wrapTwitterErrors(error, "users/show");
  }
};

(async () => {
  try {
    console.log("\nQuery: ", query);
    const userID = await getUserID(query);

    let count = 0;
    let maxId;

    const file = utils.genFilePath(query);
    await utils.deleteFile(file);

    console.log("Trying to get ", max, " tweets\n");

    const options = {
      // q: `${query} since:2020-10-11`,
      q: query,
      count: 100,
      include_entities: true,
      lang: "en",
      tweet_mode: "extended",
    };

    // Create a value for all tweets
    let allTweets = [];

    let continueLoop = true;

    /* eslint-disable no-await-in-loop */
    while (continueLoop) {
      if (maxId) options.max_id = maxId;

      const { data } = await twit.get("search/tweets", options);
      const { statuses } = data;

      if (!statuses.length) {
        console.log("Reached Max @ ", count);
        continueLoop = false;
        break;
      }

      const tweets = utils.refineTweets(statuses);
      const lastTweetId = tweets[tweets.length - 1].id;
      maxId = lastTweetId;

      if (
        allTweets.length &&
        allTweets[allTweets.length - 1].id === lastTweetId
      ) {
        console.log("Tweets are now repeating...");
        continueLoop = false;
        break;
      } else {
        console.log("Adding latest batch...");
        allTweets = [...allTweets, ...tweets];
      }

      console.log(">> Cycle completed: ", count + 100);
      count = count + 100;
    }

    console.log("\n>> Loop finished");
    const removeTweets = allTweets.filter(utils.excludeRetweets);
    const engagements = utils.filterEngagements(removeTweets, userID);
    const cleanTweets = engagements.map((tweet) => {
      const { text: rawText } = tweet;
      const text = utils.cleanText(rawText);
      return { ...tweet, text };
    });

    console.log(">> Tweets processed: ", cleanTweets.length, " tweets");

    console.log(">> Analyzing tweet sentiments...");
    const p = cleanTweets.map((tweet) => utils.analyzeSentiment(tweet.text)); // create `analyzeSentiment` promises
    const sentiments = await Promise.all(p);
    const analyzedTweets = sentiments.map((sentiment, index) => {
      const tweet = cleanTweets[index];
      return { ...tweet, ...sentiment };
    });
    console.log(">> Sentiment analyses complete!");

    await utils.writeToCSV(file, analyzedTweets, false);
    console.log("\n>> Written to file ! ", file);
  } catch (error) {
    if (error instanceof errors.UserNotFound) {
      return console.log("This is not a user account");
    }

    if (error instanceof errors.RateLimited) {
      console.log("RateLimited: Stand back for now");
    }

    console.log("Error: ", error);
  }
  return null;
})();

/*global exports require console Promise */
const util = require("util");
const fs = require("fs");
const language = require("@google-cloud/language");
const emojiStrip = require("emoji-strip");
const csvParser = require("csv-parser");
const { error } = require("console");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

// Run
// export GOOGLE_APPLICATION_CREDENTIALS=../../service-accounts/prod-service-account.json
const client = new language.LanguageServiceClient();

exports.filterRetweets = (tweets) => {
  return tweets.filter((tweet) => {
    const { text } = tweet;
    if (text.includes("RT")) return false;
    else return true;
  });
};

exports.excludeRetweets = (tweet) => {
  const { text } = tweet;
  if (text.includes("RT")) return false;
  else return true;
};

/**
 * Filter out engagements from an array of tweets
 * @param {Array} tweets refined tweets
 * @param {String} userID the user id
 * @returns {Array} array of tweets
 */
exports.filterEngagements = (tweets, userID) => {
  if (userID) {
    const engagements = tweets
      .filter((tweet) => {
        const { user_id_str } = tweet;
        return user_id_str !== userID;
      })
      .filter((tweet) => !tweet.retweeted);
    return engagements;
  }
  return tweets;
};

/**
 * Converts statuses to useful tweet format
 * @param {Array} statuses contains tweets gotten directly from twitter api
 * @returns {Array} array of refined statuses
 */
exports.refineTweets = (statuses) => {
  const tweets = statuses.map((status) => {
    const tweet = refineTweet(status);
    return tweet;
  });
  return tweets;
};

/**
 * Refine a status to convert to a useful tweet format
 * @param {object} status a tweet object gotten from twitter api
 * @private
 */
const refineTweet = (status) => {
  const { user, full_text, text, entities } = status;

  let parsedText;
  if (full_text) {
    parsedText = refineText(full_text);
  } else {
    parsedText = refineText(text);
  }

  return {
    id: status.id_str,
    id_str: status.id_str,
    created_at: status.created_at,
    user_screen_name: user.screen_name,
    text: parsedText,
    source: status.source,
    reply_count: status.reply_count,
    retweet_count: status.retweet_count,
    favorite_count: status.favorite_count,
    retweeted: status.retweeted,
    in_reply_to_status_id_str: status.in_reply_to_status_id_str,
    in_reply_to_user_id_str: status.in_reply_to_user_id_str,
    in_reply_to_screen_name: status.in_reply_to_screen_name,
    is_quote_status: status.is_quote_status,
    user_name: user.name,
    user_id_str: user.id_str,
    user_location: user.location,
    user_verified: user.verified,
    user_followers_count: user.followers_count,
    user_friends_count: user.friends_count,
    user_protected: user.protected,
    user_created_at: user.created_at,
    user_description: user.description,
    user_favourites_count: user.favourites_count,
    user_statuses_count: user.statuses_count,
    url: `https://twitter.com/${user.screen_name}/status/${status.id_str}`,
    ...refineEntities(entities),
  };
};

const refineText = (text) => {
  return text.replace(/\n/g, "<br>").replace(/\t/g, "");
};

/**
 * Refine entities
 *
 * @param {Object} entities
 * @returns {Object}
 */
const refineEntities = (entities) => {
  const { urls, media } = entities;

  let entityURLs;
  let entityMedia;

  if (urls) {
    entityURLs = urls.map((url) => url.expanded_url);
  } else {
    entityURLs = [];
  }

  if (media) {
    entityMedia = media.map((item) => item.media_url_https);
  } else {
    entityMedia = [];
  }

  return { media: entityMedia, urls: entityURLs };
};

/**
 * Clean up text
 * - strip out urls
 * - strip out line breaks
 * - remove emojis
 * @param {string} text
 */
exports.cleanText = (text) => {
  // Remove urls
  const removeURLs = text
    .replace(/(?:https?|ftp):\/\/[\n\S]+/g, "")
    .replace(/t\.co\S+/g, "");

  // Remove break tags
  const removeBreaks = removeURLs.replace(/<br>/g, "");

  // Remove emojis
  const demojify = emojiStrip(removeBreaks);

  return demojify;
};

/**
 * Analyze sentiment of a text using gcp natural language
 * @param {string} text
 * @returns {Promise<{ magnitude: number; score: number }>} sentiment magnitude and score of the text
 */
exports.analyzeSentiment = async (text) => {
  const [result] = await client.analyzeSentiment({
    document: { content: text, type: "PLAIN_TEXT" },
  });
  const sentiment = result.documentSentiment;
  const { magnitude, score } = sentiment;
  return { magnitude: toOneDecimal(magnitude), score: toOneDecimal(score) };
};

/**
 * Delete file from filesystem
 * @param {string} filename
 */
exports.deleteFile = async (filename) => {
  const deleteOp = util.promisify(fs.unlink);
  console.log(`Deleting ${filename}...`);
  await deleteOp(filename).catch((error) => {
    if (error.code === "ENOENT") {
      console.log(`File ${filename} does not exist...`);
    }
  });
  console.log(`Deleted existing ${filename}`);
  console.log("\n");
};

/**
 * Generate file path from the query
 * @param {string} query
 */
exports.genFilePath = (query) => {
  const filename = `${query.split(" ").join("_")}`;
  return `../analysis/data/${filename}.csv`;
};

/**
 * Write values to csv
 * @param {string} filename to be written to CSV
 * @param {Array} items to be written to CSV
 * @param {Boolean} append set to append to csv file
 * @returns {Promise}
 */
exports.writeToCSV = async (filename, items, append) => {
  const headers = Object.keys(items[0]);
  const header = headers.map((value) => ({ id: value, title: value }));

  const csvWriter = createCsvWriter({
    path: filename,
    header,
    append,
  });

  await csvWriter.writeRecords(items);
};

/**
 * Read csv file
 * @param {string} filename file path to the csv file
 * @returns {Promise<Array<{text:string}>>} array containing all values of the csv file
 */
exports.readCSV = (filename) => {
  const stream = fs.createReadStream(filename);

  const rows = [];
  stream.pipe(csvParser()).on("data", (row) => rows.push(row));

  return new Promise((resolve, reject) => {
    stream.on("end", () => resolve(rows));
    stream.on("error", () => reject(error));
  });
};

/**
 * Convert number to one decimal place
 * @param {Number} number
 */
const toOneDecimal = (number) => {
  return Math.round(number * 10) / 10;
};

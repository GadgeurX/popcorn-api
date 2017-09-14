// Import the neccesary modules.
import asyncq from "async-q";
import bytes from "bytes";

import BaseExtractor from "./BaseExtractor";
import Helper from "../helpers/MovieHelper";
import Util from "../../Util";
import torrentapi from "torrent-search-api";
import cheerio from "cheerio";
import rp from "request-promise";
import { maxWebRequest, movieMap, trakt } from "../../config/constants";

/** Class for extracting movies from torrents. */
export default class Extractor extends BaseExtractor {

  /**
   * Create an extractor object for movie content.
   * @param {String} name - The name of the content provider.
   * @param {Object} contentProvider - The content provider to extract content from.
   * @param {?Boolean} debug - Debug mode for extra output.
   */
  constructor(name, contentProvider, debug) {
    super(name, contentProvider);

    /**
     * The helper object for adding movies.
     * @type {Helper}
     */
    this._helper = new Helper(this.name);

    /**
     * The util object with general functions.
     * @type {Util}
     */
    this._util = new Util();
  }

  /**
   * Get all the movies.
   * @param {Object} movie - The movie information.
   * @returns {Movie} - A movie.
   */
  async _getMovie(movie) {
    try {
      const torrentapiObj = new torrentapi();
      torrentapiObj.enableProvider('T411');
      torrentapiObj.enableProvider('Torrent9');
      if (movie.provider == "T411")
        var html = await torrentapiObj.getTorrentDetails(movie.torrent);
      else if (movie.provider == "Torrent9")
      {
        var html = movie.torrent.desc;
        html = await rp(html);
      }
      const $ = cheerio.load(html);
      if (movie.provider == "T411")
        movie.torrents[movie.language][movie.quality].url = $("td.trTorrentDL.citems").eq(2).children('a').attr("href");
      else if (movie.provider == "Torrent9")
        movie.torrents[movie.language][movie.quality].url = $("div.download-btn").eq(1).children('a').attr("href");
      const newMovie = await this._helper.getTmdbInfo(movie.movieTitle, movie.year);
      if (newMovie && newMovie._id) return await this._helper.addTorrents(newMovie, movie.torrents);
    } catch (err) {
      return this._util.onError(err);
    }
  }

  /**
   * Extract movie information based on a regex.
   * @param {Object} torrent - The torrent to extract the movie information from.
   * @param {String} language - The language of the torrent.
   * @param {Regex} regex - The regex to extract the movie information.
   * @returns {Object} - Information about a movie from the torrent.
   */
  _extractMovie(torrent, language, regex) {
    let movieTitle = torrent.title.match(regex)[1];
    if (movieTitle.endsWith(" ")) movieTitle = movieTitle.substring(0, movieTitle.length - 1);
    movieTitle = movieTitle.replace(/\./g, " ");
    let slug = movieTitle.replace(/[^a-zA-Z0-9 ]/gi, "").replace(/\s+/g, "-").toLowerCase();
    if (slug.endsWith("-")) slug = slug.substring(0, slug.length - 1);
    slug = slug in movieMap ? movieMap[slug] : slug;
    var year = "";
    if (torrent.title.match(/(.*)(\d{4})(.*)/))
      year = torrent.title.match(/(.*)(\d{4})(.*)/)[2];
    var quality = "720p";
    if (torrent.title.match(/(.*)(\d{3,4}p)(.*)/))
      quality = torrent.title.match(/(.*)(\d{3,4}p)(.*)/)[2];
    if (quality == "080p")
      quality = "1080p";

    const size = torrent.size ? torrent.size : torrent.fileSize;
    var sizeNb = size.split(" ")[0];
    if (size.split(" ")[1].indexOf("G") != -1 || size.split(" ")[1].indexOf("g") != -1)
    {
      sizeNb = sizeNb * 1024 * 1024 * 1024;
    }
    if (size.split(" ")[1].indexOf("M") != -1 || size.split(" ")[1].indexOf("m") != -1)
    {
      sizeNb = sizeNb * 1024 * 1024;
    }

    const movie = {
      movieTitle,
      slug,
      slugYear: `${slug}-${year}`,
      torrentLink: torrent.link,
      year,
      quality,
      language,
      provider: torrent.provider,
      torrent: torrent
    };
    movie.torrents = {};

    movie.torrents[language] = {};
    movie.torrents[language][quality] = {
      url: torrent.magnet ? torrent.magnet : torrent.link,
      seed: torrent.seeds ? torrent.seeds : 0,
      peer: torrent.peers ? torrent.peers : 0,
      size: sizeNb,
      filesize: size,
      provider: this.name
    };

    return movie;
  }

  /**
   * Get movie info from a given torrent.
   * @param {Object} torrent - A torrent object to extract movie information from.
   * @param {String} language - The language of the torrent.
   * @returns {Object} - Information about a movie from the torrent.
   */
  _getMovieData(torrent, language) {
    const threeDimensions = /(.*).(\d{4}).[3Dd]\D+(\d{3,4}p)/i;
    const fourKay = /(.*).(\d{4}).[4k]\D+(\d{3,4}p)/i;
    const withYear = /(.*).(\d{4})\D+(\d{3,4}p)/i;
    const custom = /(.+)\b(FRENCH|TRUEFRENCH)\b(.*)/i;
    if (torrent.title.match(threeDimensions)) {
      return this._extractMovie(torrent, language, threeDimensions);
    } else if (torrent.title.match(fourKay)) {
      return this._extractMovie(torrent, language, fourKay);
    } else if (torrent.title.match(withYear)) {
      return this._extractMovie(torrent, language, withYear);
    } else if (torrent.title.match(custom)) {
      return this._extractMovie(torrent, language, custom);
    } else {
      logger.warn(`${this.name}: Could not find data from torrent: '${torrent.title}'`);
    }
  }

  /**
   * Puts all the found movies from the torrents in an array.
   * @param {Array} torrents - A list of torrents to extract movie information.
   * @param {String} language - The language of the torrent.
   * @returns {Array} - A list of objects with movie information extracted from the torrents.
   */
  async _getAllMovies(torrents, language) {
    try {
      const movies = [];
      await asyncq.mapSeries(torrents, torrent => {
        if (torrent) {
          const movie = this._getMovieData(torrent, language);
          if (movie) {
            if (movies.length != 0) {
              const { movieTitle, slug, language, quality } = movie;
              const matching = movies
                .filter(m => m.movieTitle === movieTitle)
                .filter(m => m.slug === slug);

              if (matching.length != 0) {
                const index = movies.indexOf(matching[0]);
                if (!matching[0].torrents[language][quality]) matching[0].torrents[language][quality] = movie.torrents[language][quality];

                movies.splice(index, 1, matching[0]);
              } else {
                movies.push(movie);
              }
            } else {
              movies.push(movie);
            }
          }
        }
      });
      return movies;
    } catch (err) {
      return this._util.onError(err);
    }
  }

  /**
   * Returns a list of all the inserted torrents.
   * @param {Object} provider - The provider to query content provider.
   * @returns {Movie[]} - A list of scraped movies.
   */
  async search(provider) {
    try {
      const torrents = await this._contentProvider.search(provider.query, "Movies", 1000000);
      const Nbtorrents = torrents.length; // Change to 'const' for production.
      if (!Nbtorrents) return this._util.onError(`${this.name}: total_torrents returned: '${Nbtorrents}'`);
      // totalPages = 3; // For testing purposes only.
      logger.info(`${this.name}: Total torrents ${Nbtorrents}`);

      const movies = await this._getAllMovies(torrents, provider.lang);
      return await asyncq.mapLimit(movies, maxWebRequest,
        movie => this._getMovie(movie).catch(err => this._util.onError(err)));
    } catch (err) {
      this._util.onError(err);
    }
  }

}

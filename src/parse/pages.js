/**
 * @module parse/pages
 */
import { readFileTree } from '../utils/parse';

/**
 * Parse page files.
 * @param {Object} Options
 * @return {Promise} resolving to page data
 */
function parsePages (options) {
  return readFileTree(options.src.pages, options.keys.pages, options);
}

export default parsePages;

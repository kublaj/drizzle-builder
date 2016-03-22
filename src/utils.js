import globby from 'globby';
import Promise from 'bluebird';
import path from 'path';
import {readFile as readFileCB} from 'fs';
var readFile = Promise.promisify(readFileCB);

/* Helper functions */

/**
 * Return extension-less basename of filepath
 * @param {String} filepath
 * @example basename('foo/bar/baz.txt'); // -> 'baz'
 */
function basename (filepath) {
  return path.basename(filepath, path.extname(filepath));
}

/**
 * Return normalized (no '..', '.') full dirname of filepath
 * @param {String} filepath
 * @example dirname('../ding/foo.txt'); // -> '/Users/shiela/ding/'
 */
function dirname (filepath) {
  return path.normalize(path.dirname(filepath));
}

/**
 * Return the name of this file's directory's immediate parent directory
 * @param {String} filepath
 * @example basename('foo/bar/baz.txt'); // -> 'bar'
 */
function localDirname (filepath) {
  return dirname(filepath).split(path.sep).pop();
}

/**
 * Return the name of this file's directory's immediate parent directory
 * @param {String} filepath
 * @example basename('foo/bar/baz.txt'); // -> 'foo'
 */
function parentDirname (filepath) {
  return dirname(filepath).split(path.sep).slice(-2, -1)[0];
}

/**
 * TODO: see https://github.com/cloudfour/drizzle-builder/issues/8
 */
function removeLeadingNumbers (str) {
  return str.replace(/^[0-9|\.\-]+/, '');
}

/**
 * Given an array of file objects, take all of their paths and find
 * what the common root directory is for all of them.
 * @example commonRoot([
 *  'foo/bar/baz/ding/dong.html',
 *  'foo/bar/baz/huff/dumb.txt',
 *  'foo/bar/baz/oleo.html',
 *  'foo/bar/baz/one/two.html']); // -> 'foo/bar/baz/'
 *
 * @param {Array} files     File objects. Each should have a `path` property
 * @return {String}         Common root path
 */
function commonRoot (files) {
  const paths = files.map(file => file.path);
  const relativePath = paths.reduce((prev, curr) => {
    prev = prev.split(path.sep);
    curr = curr.split(path.sep);
    prev = prev.filter(prevBit => {
      return curr.some(currBit => prevBit === currBit);
    });
    return prev.join(path.sep);
  });
  return relativePath;
}

/**
 * Return (creating if necessary) a deep reference to a nested object
 * based on path elements. This will mutate `obj` by adding needed properties
 * to it. Think of it like mkdir with a multi-directory path that will create
 * directory entries if they don't exist.
 *
 * @param {Array} pathKeys    Elements making up the "path" to the reference
 * @param {Object}            Object to add needed references to
 *
 * @example deepRef(['foo', 'bar', 'baz'], { foo: {} }); // => foo.bar.baz
 */
function deepObj (pathKeys, obj) {
  return pathKeys.reduce((prev, curr) => {
    prev[curr] = prev[curr] || {};
    return prev[curr];
  }, obj);
}

/**
 * Take a given glob and convert it to a glob that will match directories
 * (instead of files). Return Promise that resolves to matching dirs.
 *
 * @example getDirs('foo/bar/baz')
 *
 * @param {glob}    glob to convert to directory glob
 * @param {Object}  options to pass on to getFiles/globby
 * @return {Promise} resolving to glob matches
 */
function getDirs (glob, options = {}) {
  const opts = Object.assign({
    nodir: false
  }, options);
  const dirGlob = (typeof glob === 'string') ? Array.of(glob) : glob;
  return getFiles(dirGlob.map(dirEntry => path.dirname(dirEntry) + '/*/'),
    opts);
}

/**
 * @param {glob} glob
 * @return {Promise} resolving to {Array} of files matching glob
 */
function getFiles (glob, globOpts = {}) {
  const opts = Object.assign({
    nodir: true
  }, globOpts);
  return globby(glob, opts);
}

/**
 * Utility function to test if a value COULD be a glob. A single string or
 * an Array of strings counts. Just because this returns true, however,
 * doesn't mean it is a glob that makes sense, just that it looks like one.
 *
 * @param {String || Array} candidate
 * @return Boolean
 */
function isGlob (candidate) {
  if (typeof candidate === 'string' && candidate.length > 0) { return true; }
  if (Array.isArray(candidate) && candidate.length > 0) {
    return candidate.every(candidateEl => typeof candidateEl === 'string');
  }
  return false;
}

/**
 * Utility function to provide a consistent "key" for elements, materials,
 * partials, etc, based on a filepath:
 * - replace whitespace characters with `-`
 * - use only the basename, no extension
 * - unless stripNumbers option false, remove numbers from the string as well
 *
 * @param {String} str    filepath
 * @param {Object} options
 * @return {String}
 */
function keyname (str, { stripNumbers = true } = {}) {
  const name = basename(str).replace(/\s/g, '-');
  return (stripNumbers) ? removeLeadingNumbers(name) : name;
}

/**
 * Retrieve the correct parsing function for a file based on its
 * path. Each parser with a `pattern` property will compile that pattern
 * to a RegExp and test it against the filepath. If no match is found
 * against any of the parsers by path pattern, a default parser will be
 * returned: either a parser keyed by `default` in the `parsers` object
 * or, lacking that, a default function that leaves the contents of the
 * file untouched.
 *
 * @param {String} filepath
 * @param {Object} parsers
 * @see options module
 * @return {Function} applicable parsing function for file contents
 */
function matchParser (filepath, parsers = {}) {
  for (var parserKey in parsers) {
    if (parsers[parserKey].pattern) {
      if (new RegExp(parsers[parserKey].pattern).test(filepath)) {
        return parsers[parserKey].parseFn;
      }
    }
  }
  return (parsers.default && parsers.default.parseFn) ||
    ((contents, filepath) => ({ contents: contents }));
}


/**
 * Take a glob; read the files, optionally running a `contentFn` over
 * the contents of the file.
 *
 * @param {glob} glob of files to read
 * @param {Object} Options:
 *  - {Object} available parsers
 *  - {String} encoding
 *  - {Object} globOpts gets passed to getFiles
 * @return {Promise} resolving to Array of Objects:
 *  - {String} path
 *  - {String || Mixed} contents: contents of file after contentFn
 */
function readFiles (glob, {
  parsers = {},
  encoding = 'utf-8',
  globOpts = {}
} = {}) {
  return getFiles(glob, globOpts).then(paths => {
    return Promise.all(paths.map(filepath => {
      return readFile(filepath, encoding)
        .then(fileData => {
          const parser = matchParser(filepath, parsers);
          fileData = parser(fileData, filepath);
          if (typeof fileData === 'string') {
            fileData = { contents: fileData };
          }
          return Object.assign(fileData, { path: filepath });
        });
    }));
  });
}

/**
 * Read the files from a glob, but then instead of resolving the
 * Promise with an Array of objects (@see readFiles), resolve with a
 * single object; each file's contents is keyed by its filename run
 * through optional `keyFn(filePath, options)`` (default: keyname).
 * Will pass other options on to readFiles and keyFn
 *
 * @param {glob}
 * @param {Object} options (all optional):
 *  - keyFn
 *  - contentFn
 *  - stripNumbers
 * @return {Promise} resolving to {Object} of keyed file contents
 */
function readFilesKeyed (glob, options = {}) {
  const {
    keyFn = (path, options) => keyname(path, options)
  } = options;
  return readFiles(glob, options).then(allFileData => {
    const keyedFileData = new Object();
    for (var aFile of allFileData) {
      keyedFileData[keyFn(aFile.path, options)] = aFile;
    }
    return keyedFileData;
  });
}

/**
 * Given a file's path and a string representing a directory name,
 * return an Array that only contains directories at or beneath that
 * directory.
 *
 * @example relativePathArray('/foo/bar/baz/ding/dong/tink.txt', 'baz')
 *  // -> ['baz', 'ding', 'dong']
 * @param {String} filePath
 * @param {String} fromPath
 * @return {Array}
 */
function relativePathArray (filePath, fromPath) {
  const keys = path.relative(fromPath, path.dirname(filePath));
  if (keys && keys.length) {
    return keys.split(path.sep);
  }
  return [];
}

/**
 * Convert str to title case (every word will be capitalized)
 * @param {String} str
 * @return {String}
 */
function titleCase (str) {
  return str
    .toLowerCase()
    .replace(/(\-|_)/g, ' ')
    .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.substr(1));
}

export { commonRoot,
         deepObj,
         dirname,
         getDirs,
         getFiles,
         isGlob,
         keyname,
         localDirname,
         matchParser,
         parentDirname,
         readFiles,
         readFilesKeyed,
         relativePathArray,
         titleCase
       };

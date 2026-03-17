'use strict';

var File = require('dw/io/File');

/**
 * Utility class for file and path manipulations.
 */
var FileHelper = {
    /**
     * Ensures a path starts with a separator (/).
     * @param {String} path - The path string.
     * @returns {String} Formatted path.
     */
    prependSeparator: function (path) {
        if (!path) return File.SEPARATOR;
        return path.charAt(0) === File.SEPARATOR ? path : File.SEPARATOR + path;
    },

    /**
     * Ensures a path ends with a separator (/).
     * @param {String} path - The path string.
     * @returns {String} Formatted path.
     */
    appendSeparator: function (path) {
        if (!path) return File.SEPARATOR;
        return path.charAt(path.length - 1) === File.SEPARATOR ? path : path + File.SEPARATOR;
    },

    /**
     * Creates a directory path in IMPEX if it doesn't exist.
     * @param {String} fullPath - The full path to create.
     */
    createDirectory: function (fullPath) {
        var folder = new File(fullPath);
        if (!folder.exists()) {
            folder.mkdirs();
        }
    }
};

module.exports = FileHelper;
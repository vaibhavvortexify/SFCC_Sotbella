'use strict';

var File = require('dw/io/File');

exports.uploadCatalogFile = function (paramMap) {
    try {
        var directory = new File(File.IMPEX + '/src/catalog');
        if (!directory.exists()) {
            directory.mkdirs();
        }

        var file = null;

        // processMultipart() receives a closure that is called for each uploaded file
        var closure = function (fieldName, contentType, originalName) {
            dw.system.Logger.info("Multipart field: {0}, uploaded file: {1}", fieldName, originalName);

            if (!originalName) return null;

            var safeName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, '_');

            // Only allow CSV
            if (!safeName.toLowerCase().endsWith('.csv')) return null;

            file = new File(directory, safeName);
            return file;
        };

        var uploaded = paramMap.processMultipart(closure);

        // If uploaded array is empty => no file was uploaded
        if (!uploaded || uploaded.length === 0 || !file) {
            return { error: true, uploadMsg: "No file selected." };
        }

        return {
            success: true,
            uploadMsg: "File uploaded to /IMPEX/src/catalog/" + file.getName()
        };

    } catch (e) {
        return {
            error: true,
            uploadMsg: "Upload failed: " + e.message
        };
    }
};

exports.uploadPricebookFile = function (paramMap) {
    try {
        var directory = new File(File.IMPEX + '/src/pricebooks');
        if (!directory.exists()) {
            directory.mkdirs();
        }

        var file = null;

        // processMultipart() receives each uploaded file
        var closure = function (fieldName, contentType, originalName) {
            if (!originalName) return null;

            var safeName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, '_');

            if (!safeName.toLowerCase().endsWith('.csv')) {
                return null;
            }

            file = new File(directory, safeName);
            return file;
        };

        var uploaded = paramMap.processMultipart(closure);

        if (!uploaded || uploaded.length === 0 || !file) {
            return { error: true, uploadMsg: "No file selected." };
        }

        return {
            success: true,
            uploadMsg: "File uploaded to /IMPEX/src/pricebooks/" + file.getName()
        };

    } catch (e) {
        return { error: true, uploadMsg: "Upload failed: " + e.message };
    }
};


exports.processPricebookFile = function () {
    return { msg: 'Pricebook processing completed.' };
};

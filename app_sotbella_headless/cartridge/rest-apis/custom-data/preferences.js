'use strict';

var Site = require('dw/system/Site');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');

function safelyParseJSON(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (e) {
        return value;
    }
}

exports.getPreferencesData = function () {
    var pref = Site.getCurrent().getPreferences().getCustom();
    response.setExpires(0); // Disable caching

    var result = {};

    var frontendPrefList = pref.frontendPreferences;
    if (!frontendPrefList) {
        return { error: 'frontendPreferences not defined in Site Preferences' };
    }

    // ✅ Convert Java String[] to JavaScript Array
    var frontendPrefKeys = Array.from(frontendPrefList);

    frontendPrefKeys.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(pref, key)) {
            result[key] = safelyParseJSON(pref[key]);
        } else {
            result[key] = null;
        }
    });

    return result;
};

exports.getPreferences = function () {
    RESTResponseMgr.createSuccess(exports.getPreferencesData()).render();
};

exports.getPreferences.public = true;

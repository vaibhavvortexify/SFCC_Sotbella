'use strict';

var ISML = require('dw/template/ISML');

exports.render = function(template, model) {
    ISML.renderTemplate(template, model);
};

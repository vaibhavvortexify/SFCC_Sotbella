'use strict';

/**
 * @namespace Default
 */

var server = require('server');

/** when sitepath is defined in the site aliases from business manager, homepage will be rendered directly */
/**
 * Default-Start : This end point is the root of the site, when opening from the BM this is the end point executed
 * @name Base/Default-Start
 * @function
 * @memberof Default
 * @param {serverfunction} - get
 */
server.get('Start', function (req, res, next) {
    res.redirect('https://www.sotbella.com');
    next();
});


module.exports = server.exports();

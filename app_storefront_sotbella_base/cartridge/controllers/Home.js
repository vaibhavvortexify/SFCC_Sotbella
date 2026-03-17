'use strict';

/**
 * @namespace Home
 */

var server = require('server');

/**
 * Home-Show : This endpoint is called when a navigates and shows error page.
 * @name Base/Home-Show
 * @function
 * @memberof Home
 * @param {serverfunction} - get
 */
server.get('Show', function (req, res, next) {
    res.redirect('https://www.sotbella.com');
    next();
});
module.exports = server.exports();

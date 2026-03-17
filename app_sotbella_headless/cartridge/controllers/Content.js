'use strict';

var server = require('server');
var Logger = require('dw/system/Logger');
var ContentMgr = require('dw/content/ContentMgr');
var cache = require('*/cartridge/scripts/middleware/cache');

function getContentBody(contentId) {
	var contentBody = '';
	try {
		var content = ContentMgr.getContent(contentId);
		var isOnline = content && content.onlineFlag;
		if (isOnline && content.custom && content.custom.body) {
			contentBody = JSON.parse(content.custom.body.toString());
		}
	} catch (error) {
		Logger.error('SCAPI[Cutom] - Content ERROR', error.message);
		return '';
	}
	return contentBody;
}

server.get('Get', cache.applyDefaultCache, function (req, res, next) {
	var contentAssetID = req.querystring.contentId;

	if (!contentAssetID) {
		res.setStatusCode(400);
		res.json({
			error: true,
			message: 'Missing content asset ID.',
		});
		return next();
	}

	if (contentAssetID === 'HomePage') {
		var header = getContentBody('header');
		var footer = getContentBody('footer');
		var homePage = getContentBody('home-page');

		var content = {
			header: header || '',
			homePage: homePage || '',
			footer: footer || '',
		};

		res.json({
			body: content,
		});
		return next();
	}

	var contentAsset = ContentMgr.getContent(contentAssetID);

	if (!contentAsset) {
		res.setStatusCode(404);
		res.json({
			error: true,
			message: 'Content asset not found.',
		});
		return next();
	}

	if (!contentAsset.custom.body) {
		res.setStatusCode(404);
		res.json({
			error: true,
			message: 'Content asset body is null.',
		});
		return next();
	}

	var body;
	try {
		body = JSON.parse(contentAsset.custom.body.source);
	} catch (e) {
		body = contentAsset.custom.body.source;
	}
	var data = {
		body: body,
	};

	res.json(data);
	next();
});

module.exports = server.exports();

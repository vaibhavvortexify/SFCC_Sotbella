'use strict';

var Logger = require('dw/system/Logger');
var ContentMgr = require('dw/content/ContentMgr');

function parseContent(data) {
	try {
		var parsed = JSON.parse(data);
		return parsed;
	} catch (e) {
		return data;
	}
}

function getSizeGuide(wearType) {
	var sizeGuideTopwear = ContentMgr.getContent('size-guide-topwear');
	var sizeGuideBottomwear = ContentMgr.getContent('size-guide-bottomwear');
	var sizeGuideDataTopwear = ContentMgr.getContent('size-guide-data-bottomwear');
	var sizeGuideDataBottomwear = ContentMgr.getContent('size-guide-data-topwear');

	if (wearType === 'topwear') {
		if (
			!sizeGuideTopwear ||
			!sizeGuideTopwear.custom.body ||
			!sizeGuideDataTopwear ||
			!sizeGuideDataTopwear.custom.body
		) {
			Logger.info(`No Size Guide found with Id: 'size-guide-topwear' or Body is Empty.`);
		} else {
			return {
				sizeTopwear: parseContent(sizeGuideTopwear.custom.body.source),
				sizeDataTopwear: parseContent(sizeGuideDataTopwear.custom.body.source),
			};
		}
	}

	if (wearType === 'bottomwear') {
		if (
			!sizeGuideBottomwear ||
			!sizeGuideBottomwear.custom.body ||
			!sizeGuideDataBottomwear ||
			!sizeGuideDataBottomwear.custom.body
		) {
			Logger.info(`No Size Guide found with Id: 'size-guide-bottomwear' or Body is Empty.`);
		} else {
			return {
				sizeBottomwear: parseContent(sizeGuideBottomwear.custom.body.source),
				sizeDataBottomwear: parseContent(sizeGuideDataBottomwear.custom.body.source),
			};
		}
	}
}

module.exports = {
	getSizeGuide,
};

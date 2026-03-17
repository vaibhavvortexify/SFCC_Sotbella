'use strict'

/* eslint-disable require-jsdoc */
var Logger = require('dw/system/Logger');
var ContentMgr = require('dw/content/ContentMgr');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');

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

exports.getContentData = function (contentId) {
    var contentData;

    if (contentId === 'HomePage') {
        contentData = {
            header: getContentBody('header'),
            homePage: getContentBody('home-page'),
            footer: getContentBody('footer')
        }
    } else {
        try {
            var content = ContentMgr.getContent(contentId);
            var isOnline = content && content.onlineFlag;
            contentData = {
                body: isOnline ? JSON.parse(content.custom.body.toString()) : ''
            };
        } catch (error) {
            Logger.error('SCAPI[Cutom] - Content ERROR', error.message);
            contentData = {
                errorMsg: error
            }
            return contentData;
        }
    }

    response.setExpires(0);
    return contentData;
};
exports.getContent = function () {
    var contentId = request.getSCAPIPathParameters().get('contentId');
    var content = exports.getContentData(contentId);
    if (content) {
        RESTResponseMgr.createSuccess(content).render();
    } else { 
        RESTResponseMgr.createSuccess({msg: 'Content Not Found !' }).render();

    }
};

exports.getContent.public = true;
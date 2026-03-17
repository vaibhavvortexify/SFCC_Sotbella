'use strict';

var responseHelper = require('../scripts/responseHelper');
var impexUploadHelper = require('../scripts/helpers/impexUploadHelper');
var Logger = require('dw/system/Logger');
/**
 * ShowCatalog
 */
function ShowCatalog() {
    var model = {};
    var uploadedFile = { error: false };
    Logger.info("submitFile param = {0}", request.httpParameterMap.submitFile.stringValue);
Logger.info("HTTP Method = {0}", request.httpMethod);


    var isPOST = request.httpMethod === 'POST';
    var isSubmit = request.httpParameterMap.submitFile.stringValue === 'true';

    if (isPOST && isSubmit) {
        uploadedFile = impexUploadHelper.uploadCatalogFile(request.httpParameterMap);
        var URLUtils = require('dw/web/URLUtils');
        var redirectParams = {
            'success': uploadedFile.success || false,
            'error': uploadedFile.error || false,
            'uploadMsg': uploadedFile.uploadMsg || ''
        };
        // Redirect to a GET call of ShowCatalog, passing status message as parameters
        response.redirect(URLUtils.url('IMPEXUploadController-ShowCatalog', redirectParams));
        return;
    }


    model.success = uploadedFile.success || false;
    model.error = uploadedFile.error || false;
    model.uploadMsg = uploadedFile.uploadMsg;

    responseHelper.render('impexUpload/showCatalog', model);
}

/**
 * ProcessCatalog
 */
function ProcessCatalog() {
    var result = impexUploadHelper.processCatalogFile();
    responseHelper.render('impexUpload/processCatalog', result);
}


/**
 * ShowPricebook
 */
function ShowPricebook() {
    var model = {};
    var uploadedFile = { error: false };

    var isPOST = request.httpMethod === 'POST';
    var isSubmit = request.httpParameterMap.submitFile.stringValue === 'true';

    if (isPOST && isSubmit) {
        uploadedFile = impexUploadHelper.uploadPricebookFile(request.httpParameterMap);
        var URLUtils = require('dw/web/URLUtils');
        var redirectParams = {
            'success': uploadedFile.success || false,
            'error': uploadedFile.error || false,
            'uploadMsg': uploadedFile.uploadMsg || ''
        };
        response.redirect(URLUtils.url('IMPEXUploadController-ShowPricebook', redirectParams));
        return;
    }

    model.success = uploadedFile.success || false;
    model.error = uploadedFile.error || false;
    model.uploadMsg = uploadedFile.uploadMsg;

    responseHelper.render('impexUpload/showPricebook', model);
}

/**
 * ProcessPricebook
 */
function ProcessPricebook() {
    var result = impexUploadHelper.processPricebookFile();
    responseHelper.render('impexUpload/processPricebook', result);
}

ShowPricebook.public = true;
exports.ShowPricebook = ShowPricebook;

ProcessPricebook.public = true;
exports.ProcessPricebook = ProcessPricebook;

ShowCatalog.public = true;
exports.ShowCatalog = ShowCatalog;

ProcessCatalog.public = true;
exports.ProcessCatalog = ProcessCatalog;

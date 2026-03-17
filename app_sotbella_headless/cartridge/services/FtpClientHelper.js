'use strict';

function FtpClientHelper(service) {
    this.service = service;
}

/**
 * Navigates to a target directory on the remote server.
 * Uses leading slash to ensure absolute pathing.
 */
FtpClientHelper.prototype.enterDirectory = function (targetFolder) {
    // Ensure the folder starts with a forward slash for SFTP absolute pathing
    var folderPath = targetFolder.charAt(0) === '/' ? targetFolder : '/' + targetFolder;
    
    // 1. Attempt to change directory (cd)
    var serviceResult = this.service.call('cd', folderPath);
    
    if (!serviceResult.isOk()) {
        // 2. If cd fails, it might not exist. Attempt to create it (mkdir)
        // Note: mkdir might fail if permissions are restricted at root
        this.service.call('mkdir', folderPath);
  
        // 3. Retry the cd after attempting mkdir
        var retryCd = this.service.call('cd', folderPath);
        
        if (!retryCd.isOk()) {
            // Log the actual error message from the service for better debugging
            throw new Error('FTP Helper: Could not change to or create directory: ' + folderPath + '. Service Error: ' + retryCd.getErrorMessage());
        }
    }
};

/**
 * Uploads a local file to the remote server.
 */
FtpClientHelper.prototype.uploadFile = function (targetFolder, file) {
    this.enterDirectory(targetFolder);

    // Ensure remote path is constructed correctly
    var remoteFolder = targetFolder.endsWith('/') ? targetFolder : targetFolder + '/';
    var remoteFilePath = remoteFolder + file.getName();
    
    var serviceResult = this.service.call('putBinary', remoteFilePath, file);
    
    if (!serviceResult.isOk() || !serviceResult.getObject()) {
        throw new Error('FTP Helper: Failed to upload ' + file.getName() + ' to ' + remoteFilePath + '. Error: ' + serviceResult.getErrorMessage());
    }
};

module.exports = FtpClientHelper;
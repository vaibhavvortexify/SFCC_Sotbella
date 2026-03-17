'use strict'

var Logger = require('dw/system/Logger');
var File = require('dw/io/File');
var Status = require('dw/system/Status');
var FileWriter = require('dw/io/FileWriter');
var XMLStreamWriter = require('dw/io/XMLStreamWriter');
var getInventoryUpdates = require('*/cartridge/services/unicomInventorySnapshot').getInventoryUpdates;
var callGetInventoryUpdates = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callGetInventoryUpdates;

exports.execute = function (parameters) {
    try { 
        var response = callGetInventoryUpdates(parameters.lastNMinutes, '', function(lastNMinutes, skuIds, token) {
            return getInventoryUpdates(lastNMinutes, skuIds, token);
        });

        if (response && response.status === 'OK') {
            Logger.info('Unicommerce Inventory Updates fetched successfully.: {0}', JSON.stringify(response));
            if (response.object.inventorySnapshots.length === 0) {
                Logger.info('No Inventory Updates found in Unicommerce for the given last N minutes: {0}', parameters.lastNMinutes);
                return new Status(Status.WARN, 'NO_UPDATES', 'No Inventory Updates found in Unicommerce for the given time frame.');
            }
            var xmlFileName = parameters.xmlFileName || 'import_inventory.xml';
            var directory = new File(File.IMPEX + File.SEPARATOR + 'src' + File.SEPARATOR + parameters.XMLFilePath);
            if (!directory.exists()) {
                directory.mkdirs();
            }   
            var xmlfile = new File(directory, xmlFileName);
            xmlfile.createNewFile();
            var fileWriter = new FileWriter(xmlfile, 'UTF-8');
            var xsw = new XMLStreamWriter(fileWriter);
            xsw.writeStartDocument();
            xsw.writeStartElement('inventory');
            xsw.writeAttribute('xmlns', 'http://www.demandware.com/xml/impex/inventory/2007-05-31');

            if (parameters.InventoryIds && parameters.InventoryIds.trim().length > 0){
                var inventoryIdsArray = parameters.InventoryIds.split(';').map(function(id) { return id.trim(); });
                Logger.info('Fetching inventory for Inventory IDs: {0}', inventoryIdsArray.join(', '));

                for (var j = 0; j < inventoryIdsArray.length; j++) {
                    var inventoryId = inventoryIdsArray[j];
                    xsw.writeStartElement('inventory-list');
                    xsw.writeStartElement('header');
                    xsw.writeAttribute('list-id', inventoryId);
                    xsw.writeStartElement('default-instock');
                    xsw.writeCharacters('false');
                    xsw.writeEndElement(); // default-instock
                    xsw.writeStartElement('use-bundle-inventory-only');
                    xsw.writeCharacters('false');
                    xsw.writeEndElement(); // use-bundle-inventory-only
                    xsw.writeStartElement('on-order');
                    xsw.writeCharacters('false');
                    xsw.writeEndElement(); // on-order
                    xsw.writeEndElement(); // header

                    xsw.writeStartElement('records');
                    for (var i = 0; i < response.object.inventorySnapshots.length; i++) {
                        var sku = response.object.inventorySnapshots[i].itemTypeSKU;
                        var inventory = response.object.inventorySnapshots[i].inventory;
                        xsw.writeStartElement('record');
                        xsw.writeAttribute('product-id', sku);
                        xsw.writeStartElement('allocation');
                        xsw.writeCharacters(inventory);
                        xsw.writeEndElement(); // allocation
                        xsw.writeStartElement('perpetual');
                        xsw.writeCharacters('false');
                        xsw.writeEndElement(); // perpetual
                        xsw.writeStartElement('preorder-backorder-handling');
                        xsw.writeCharacters('none');
                        xsw.writeEndElement(); // preorder-backorder-handling
                        xsw.writeEndElement(); // record
                    }
                    xsw.writeEndElement(); // records

                    xsw.writeEndElement(); // inventory-list
                }
            }
            xsw.writeEndElement(); // inventory
            xsw.writeEndDocument();
            xsw.close();
   
            return new Status(Status.OK);
        } else {
            Logger.error('Failed to fetch Unicommerce Inventory Updates. Response: {0}', JSON.stringify(response.errorMessage));
            return new Status(Status.ERROR, 'Error', 'Failed to fetch Unicommerce Inventory Updates.');
        }
    } catch (e) {
        return new Status(Status.ERROR, 'Error', '[Exception in writeInventoryXMLFile job] Exception: {0}', JSON.stringify(e));
    }    
}
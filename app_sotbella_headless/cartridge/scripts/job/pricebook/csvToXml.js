'use strict';

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var CSVStreamReader = require('dw/io/CSVStreamReader');
var XMLStreamWriter = require('dw/io/XMLStreamWriter');
var FileWriter = require('dw/io/FileWriter');
var Logger = require('dw/system/Logger');
var Status = require('dw/system/Status');
var Site = require('dw/system/Site');

exports.execute = function () {

    try {
        var configJSON = Site.current.getCustomPreferenceValue('pricebooksWithSite');
        if (!configJSON) {
            Logger.error("pricebooksWithSite custom preference missing");
            return new Status(Status.ERROR);
        }

        var config = JSON.parse(configJSON);
        var siteID = Site.current.ID;

        var listPriceBookId     = config.listPriceBookId;
        var salePriceBookId     = config.salePriceBookId;
        var listPricebookName   = config.listPricebookName;
        var salePricebookName   = config.salePricebookName;
        var currency            = config.currency;
        var csvFileName         = config.csvFile;

        var csvFile = new File(File.IMPEX + '/src/pricebooks/' + csvFileName);

        if (!csvFile.exists()) {
            Logger.error('CSV file not found: ' + csvFile.fullPath);
            return new Status(Status.ERROR, 'ERROR', 'CSV file not found');
        }

       
        var listXMLFile = new File(File.IMPEX + '/src/pricebooks/xml/' + listPriceBookId + '.xml');
        var saleXMLFile = new File(File.IMPEX + '/src/pricebooks/xml/' + salePriceBookId + '.xml');

        var reader = new CSVStreamReader(new FileReader(csvFile));
        var lineCount = 0;

        var listWriter = new XMLStreamWriter(new FileWriter(listXMLFile, 'UTF-8'));
        var saleWriter = new XMLStreamWriter(new FileWriter(saleXMLFile, 'UTF-8'));

        
        listWriter.writeStartDocument();
        listWriter.writeStartElement('pricebooks');
        listWriter.writeAttribute('xmlns', 'http://www.demandware.com/xml/impex/pricebook/2006-10-31');
        listWriter.writeStartElement('pricebook');

        listWriter.writeStartElement('header');
        listWriter.writeAttribute('pricebook-id', listPriceBookId);

        listWriter.writeStartElement('currency');
        listWriter.writeCharacters(currency);
        listWriter.writeEndElement();

        listWriter.writeStartElement('display-name');
        listWriter.writeAttribute('xml:lang', 'x-default');
        listWriter.writeCharacters(listPricebookName);
        listWriter.writeEndElement();

        listWriter.writeStartElement('online-flag');
        listWriter.writeCharacters('true');
        listWriter.writeEndElement();

        listWriter.writeEndElement(); // header
        listWriter.writeStartElement('price-tables');

        
        saleWriter.writeStartDocument();
        saleWriter.writeStartElement('pricebooks');
        saleWriter.writeAttribute('xmlns', 'http://www.demandware.com/xml/impex/pricebook/2006-10-31');
        saleWriter.writeStartElement('pricebook');

        saleWriter.writeStartElement('header');
        saleWriter.writeAttribute('pricebook-id', salePriceBookId);

        saleWriter.writeStartElement('currency');
        saleWriter.writeCharacters(currency);
        saleWriter.writeEndElement();

        saleWriter.writeStartElement('display-name');
        saleWriter.writeAttribute('xml:lang', 'x-default');
        saleWriter.writeCharacters(salePricebookName);
        saleWriter.writeEndElement();

        saleWriter.writeStartElement('online-flag');
        saleWriter.writeCharacters('true');
        saleWriter.writeEndElement();

        saleWriter.writeStartElement('parent');
        saleWriter.writeCharacters(listPriceBookId);
        saleWriter.writeEndElement();

        saleWriter.writeEndElement(); // header
        saleWriter.writeStartElement('price-tables');


        var line;
        while ((line = reader.readNext())) {
            lineCount++;
            if (lineCount === 1) continue; // skip header

            var productId = line[0];
            var listPrice = line[1];
            var salePrice = line[2];

            if (!productId || !listPrice) continue;

            // LIST PRICEBOOK
            listWriter.writeStartElement('price-table');
            listWriter.writeAttribute('product-id', productId);

            listWriter.writeStartElement('amount');
            listWriter.writeAttribute('quantity', '1');
            listWriter.writeCharacters(listPrice);
            listWriter.writeEndElement();

            listWriter.writeEndElement();

            // SALE PRICEBOOK
            if (salePrice) {
                saleWriter.writeStartElement('price-table');
                saleWriter.writeAttribute('product-id', productId);

                saleWriter.writeStartElement('amount');
                saleWriter.writeAttribute('quantity', '1');
                saleWriter.writeCharacters(salePrice);
                saleWriter.writeEndElement();

                saleWriter.writeEndElement();
            }
        }

        listWriter.writeEndElement(); // price-tables
        listWriter.writeEndElement(); // pricebook
        listWriter.writeEndElement(); // pricebooks
        listWriter.writeEndDocument();

        saleWriter.writeEndElement();
        saleWriter.writeEndElement();
        saleWriter.writeEndElement();
        saleWriter.writeEndDocument();

        reader.close();
        listWriter.close();
        saleWriter.close();

        Logger.info('XML generation completed for site: ' + siteID);
        return new Status(Status.OK);

    } catch (e) {
        Logger.error('Error generating pricebooks: ' + e.message);
        return new Status(Status.ERROR);
    }
};

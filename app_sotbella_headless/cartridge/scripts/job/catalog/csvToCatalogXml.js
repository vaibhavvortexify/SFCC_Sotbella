
'use strict';

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var FileWriter = require('dw/io/FileWriter');
var CSVStreamReader = require('dw/io/CSVStreamReader');
var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var System = require('dw/system/System');

/* ---------------------------------------------------
 * XML HELPERS
 * --------------------------------------------------- */

/** Escape text for XML element content/attribute */
function escapeXml(s) {
    if (!s && s !== 0) return '';
    s = String(s);
    return s.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** Clean broken CSV HTML */
function cleanHtmlValue(v) {
    if (!v) return '';
    v = v.replace(/"]+$/, '');
    return v;
}

/** Detect if a string contains HTML */
function isHTML(value) {
    if (!value) return false;
    value = value.trim();
    var htmlRegex = /<\/?[a-z][\s\S]*>/i;
    return htmlRegex.test(value);
}

/** Wrap HTML inside CDATA, plain text stays escaped */
function wrapValue(value) {
    if (!value) return '';
    value = cleanHtmlValue(value);

    if (isHTML(value)) {
        var safe = value.replace(']]>', ']]]]><![CDATA[>');
        return '<![CDATA[' + safe + ']]>';
    }
    return escapeXml(value);
}

function convertToISOFormat(dateString) {
    if (!dateString) return '';

    var isoMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(dateString);
    if (isoMatch) {
        var year = +isoMatch[1], month = +isoMatch[2] - 1, day = +isoMatch[3];
        var hr = +isoMatch[4], mn = +isoMatch[5], sc = +isoMatch[6];
        var d = new Date(Date.UTC(year, month, day, hr, mn, sc));
        return d.toISOString();
    }

    var isoOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (isoOnly) {
        var y = +isoOnly[1], m = +isoOnly[2] - 1, d2 = +isoOnly[3];
        return new Date(Date.UTC(y, m, d2)).toISOString();
    }

    var fallback = new Date(dateString);
    if (!isNaN(fallback.getTime())) return fallback.toISOString();

    Logger.warn("Invalid date format: " + dateString);
    return '';
}

/** Build attribute string */
function attrsToString(attrs) {
    if (!attrs) return '';
    var parts = [];
    Object.keys(attrs).forEach(function (k) {
        parts.push(k + '="' + escapeXml(attrs[k]) + '"');
    });
    return parts.length ? ' ' + parts.join(' ') : '';
}

/** XML tag helpers */
function element(name, text, attrs) {
    var a = attrsToString(attrs);
    return '<' + name + a + '>' + escapeXml(text || '') + '</' + name + '>';
}
function buildTagList(tagString) {
    if (!tagString) return '';

    var tags = tagString.split(',')
        .map(function (t) { return t.trim(); })
        .filter(function (t) { return t.length > 0; });

    if (!tags.length) return '';

    var out = '      <custom-attribute attribute-id="tags">\n';
    tags.forEach(function (tag) {
        out += '        <value>' + wrapValue(tag) + '</value>\n';
    });
    out += '      </custom-attribute>';

    return out;
}

function openTag(name, attrs) {
    return '<' + name + (attrs ? attrsToString(attrs) : '') + '>';
}
function emptyTag(name, attrs) {
    return '<' + name + (attrs ? attrsToString(attrs) : '') + '/>';
}
function buildImagesSection(imageList, imageAlt, imageTitle) {
    if (!imageList) return '';

    var imgs = imageList.split(',')
        .map(function (i) { return i.trim(); })
        .filter(function (i) { return i.length > 0; });

    if (!imgs.length) return '';

    var BASE_PATH = 'product/images/large/'; // HARDCODED

    var out = [];
    out.push('    <images>');
    out.push('      <image-group view-type="large">');

    imgs.forEach(function (img) {
        var fullPath = BASE_PATH + img;

        out.push('        <image path="' + escapeXml(fullPath) + '">');
        out.push('          <alt xml:lang="x-default">' + wrapValue(imageAlt) + '</alt>');
        out.push('          <title xml:lang="x-default">' + wrapValue(imageTitle) + '</title>');
        out.push('        </image>');
    });

    out.push('      </image-group>');
    out.push('    </images>');

    return out.join('\n');
}

/* ---------------------------------------------------
 * MAIN EXECUTE FUNCTION
 * --------------------------------------------------- */

exports.execute = function () {
    try {
        var importDir = File.IMPEX + '/src/catalog/';
        var inputFile = new File(importDir + System.getPreferences().getCustom()['catalogCSVFileName'] || 'productToImport.csv');
        var outputDir = new File(importDir + '/generated/');
        if (!outputDir.exists()) outputDir.mkdirs();

        var outputFile = new File(outputDir, System.getPreferences().getCustom()['masterCatalog'] || 'sotbella-master.xml');

        if (!inputFile.exists()) {
            Logger.error('CSV not found: ' + inputFile.fullPath);
            return new Status(Status.ERROR, 'ERROR', 'CSV file not found');
        }

        var reader = new CSVStreamReader(new FileReader(inputFile));
        var headers = reader.readNext();
        if (!headers) {
            reader.close();
            return new Status(Status.ERROR, 'ERROR', 'CSV headers not found');
        }

        headers = headers.map(function (h) { return h.trim(); });

        var row, masters = {}, variants = [];

        while ((row = reader.readNext())) {
            if (!row || !row.length) continue;

            var rec = {};
            for (var i = 0; i < headers.length; i++) {
                rec[headers[i]] = (row[i] || '').trim();
            }

            var type = (rec.RecordType || '').toLowerCase();
            if (type === 'master') masters[rec.ProductID] = rec;
            else if (type === 'variant') variants.push(rec);
        }
        reader.close();

        var variationAttributes = [];
        try { variationAttributes = JSON.parse(System.getPreferences().getCustom()['variationAttributes'] || '{}'); }
        catch (e) { variationAttributes = []; }

        // streaming: write directly rather than building a huge array
        var fw = new FileWriter(outputFile, 'UTF-8');
        function writeLine(s) { fw.write((s || '') + '\n'); }

        writeLine('<?xml version="1.0" encoding="UTF-8"?>');
        writeLine('<catalog xmlns="http://www.demandware.com/xml/impex/catalog/2006-10-31" catalog-id="sotbella-master">');

        writeLine('  <header>');
        writeLine('    <image-settings>');
        writeLine('      ' + openTag('internal-location', { 'base-path': '/' }) + '</internal-location>');
        writeLine('      <view-types>');
        ['large', 'medium', 'small', 'swatch'].forEach(function (v) {
            writeLine('        ' + element('view-type', v));
        });
        writeLine('      </view-types>');
        writeLine('      ' + element('alt-pattern', '${productname}'));
        writeLine('      ' + element('title-pattern', '${productname}'));
        writeLine('    </image-settings>');
        writeLine('  </header>');

        var systemFields = [
            'RecordType', 'ProductID', 'MasterID', 'displayName', 'description',
            'MinOrderQuantity', 'StepQuantity', 'TaxClass', 'brand', 'category'
        ];

        /* ------------------------------
         * MASTER PRODUCTS
         * ------------------------------ */
        Object.keys(masters).forEach(function (pid) {
            var m = masters[pid];
            var mVariants = variants.filter(function (v) { return v.MasterID === pid; });

            writeLine('  <product product-id="' + escapeXml(pid) + '">');
            writeLine('    ' + emptyTag('ean'));
            writeLine('    ' + emptyTag('upc'));
            writeLine('    ' + emptyTag('unit'));
            writeLine('    ' + element('min-order-quantity', m.MinOrderQuantity || '1'));
            writeLine('    ' + element('step-quantity', m.StepQuantity || '1'));
            writeLine('    <display-name xml:lang="x-default">' + wrapValue(m.displayName) + '</display-name>');
            writeLine('    <long-description xml:lang="x-default">' + wrapValue(m.description) + '</long-description>');
            writeLine('    ' + element('store-force-price-flag', 'false'));
            writeLine('    ' + element('store-non-inventory-flag', 'false'));
            writeLine('    ' + element('store-non-revenue-flag', 'false'));
            writeLine('    ' + element('store-non-discountable-flag', 'false'));

            writeLine('    ' + element('online-flag', (m.onlineFlag || 'true').toLowerCase()));

            var oFrom = convertToISOFormat(m.onlineFrom);
            if (oFrom) writeLine('    ' + element('online-from', oFrom));

            var oTo = convertToISOFormat(m.onlineTo);
            if (oTo) writeLine('    ' + element('online-to', oTo));

            writeLine('    ' + element('available-flag', 'true'));
            writeLine('    ' + element('searchable-flag', (m.searchableFlag || 'true').toLowerCase()));
            var imagesSection = buildImagesSection(m.images, m.imageAlt, m.imageTitle);
            if (imagesSection) {
                var imgLines = imagesSection.split('\n');
                for (var li = 0; li < imgLines.length; li++) writeLine(imgLines[li]);
            }
            writeLine('    ' + element('tax-class-id', m.TaxClass || 'Standard'));
            writeLine('    ' + element('brand', m.brand || ''));
            var hasPageTitle = m.pageTitle && m.pageTitle.trim() !== '';
            var hasPageDesc = m.pageDescription && m.pageDescription.trim() !== '';

            if (hasPageTitle || hasPageDesc) {
                writeLine('    <page-attributes>');
                if (hasPageTitle) {
                    writeLine('      <page-title xml:lang="x-default">' + wrapValue(m.pageTitle) + '</page-title>');
                }
                if (hasPageDesc) {
                    writeLine('      <page-description xml:lang="x-default">' + wrapValue(m.pageDescription) + '</page-description>');
                }
                writeLine('    </page-attributes>');
            } else {
                writeLine('    <page-attributes/>');
            }


            /* CUSTOM ATTRIBUTES */
            writeLine('    <custom-attributes>');

            ['Color', 'material', 'discountPercentage', 'weight', 'weightUnit'].forEach(function (f) {
                if (m[f]) {
                    writeLine('      <custom-attribute attribute-id="' + f + '">' + wrapValue(m[f]) + '</custom-attribute>');
                }
            });

            if (m.returnAnExchange) {
                writeLine('      <custom-attribute attribute-id="returnAnExchange">' + wrapValue(m.returnAnExchange) + '</custom-attribute>');
            }
            if (m.tags) {
                var tagsBlock = buildTagList(m.tags);
                if (tagsBlock) {
                    var tlines = tagsBlock.split('\n');
                    for (var ti = 0; ti < tlines.length; ti++) writeLine(tlines[ti]);
                }
            }
            Object.keys(m).forEach(function (key) {
                if (systemFields.indexOf(key) === -1 &&
                    !['Color', 'material', 'discountPercentage', 'weight', 'weightUnit', 'returnAnExchange', 'onlineFlag', 'searchableFlag', 'onlineFrom', 'onlineTo', 'tags', 'images', 'imageAlt', 'imageTitle']
                        .includes(key) &&
                    m[key]) {

                    writeLine('      <custom-attribute attribute-id="' + key + '">' + wrapValue(m[key]) + '</custom-attribute>');
                }
            });

            writeLine('    </custom-attributes>');

            /* VARIATIONS */
            writeLine('    <variations>');
            writeLine('      <attributes>');

            var valuesMap = {};
            variationAttributes.forEach(function (attr) { valuesMap[attr.id] = {}; });
            
            mVariants.forEach(function (v) {
                variationAttributes.forEach(function (attr) {
                    if (v[attr.id]) valuesMap[attr.id][v[attr.id]] = true;
                });
            });

            variationAttributes.forEach(function (attr) {
                writeLine('        <variation-attribute attribute-id="' + attr.id + '" variation-attribute-id="' + attr.id + '">');
                writeLine('          <display-name xml:lang="x-default">' + wrapValue(attr.displayName) + '</display-name>');
                writeLine('          <variation-attribute-values>');
                Object.keys(valuesMap[attr.id]).forEach(function (val) {
                    writeLine('            <variation-attribute-value value="' + escapeXml(val) + '">');
                    writeLine('              <display-value xml:lang="x-default">' + wrapValue(val) + '</display-value>');
                    writeLine('            </variation-attribute-value>');
                });
                writeLine('          </variation-attribute-values>');
                writeLine('        </variation-attribute>');
            });

            writeLine('      </attributes>');
            writeLine('      <variants>');
            mVariants.forEach(function (v, idx) {
                var def = idx === 0 ? ' default="true"' : '';
                writeLine('        <variant product-id="' + escapeXml(v.ProductID) + '"' + def + '/>');
            });
            writeLine('      </variants>');
            writeLine('    </variations>');

            writeLine('    <classification-category catalog-id="sotbella-in-storefront">' + wrapValue(m.category || '') + '</classification-category>');
            
            writeLine('    <pinterest-enabled-flag>false</pinterest-enabled-flag>');
            writeLine('    <facebook-enabled-flag>false</facebook-enabled-flag>');
            writeLine('    <store-attributes>');
            writeLine('      <force-price-flag>false</force-price-flag>');
            writeLine('      <non-inventory-flag>false</non-inventory-flag>');
            writeLine('      <non-revenue-flag>false</non-revenue-flag>');
            writeLine('      <non-discountable-flag>false</non-discountable-flag>');
            writeLine('    </store-attributes>');
            writeLine('  </product>');
        });

        /* ------------------------------
         * VARIANT PRODUCTS AS STANDALONE
         * ------------------------------ */
        variants.forEach(function (vr) {

            writeLine('  <product product-id="' + escapeXml(vr.ProductID) + '">');
            writeLine('    ' + emptyTag('ean'));
            writeLine('    ' + emptyTag('upc'));
            writeLine('    ' + emptyTag('unit'));
            writeLine('    ' + element('min-order-quantity', vr.MinOrderQuantity || '1'));
            writeLine('    ' + element('step-quantity', vr.StepQuantity || '1'));
            writeLine('    <display-name xml:lang="x-default">' + wrapValue(vr.displayName) + '</display-name>');
            writeLine('    <long-description xml:lang="x-default">' + wrapValue(vr.description) + '</long-description>');
            writeLine('    ' + element('store-force-price-flag', 'false'));
            writeLine('    ' + element('store-non-inventory-flag', 'false'));
            writeLine('    ' + element('store-non-revenue-flag', 'false'));
            writeLine('    ' + element('store-non-discountable-flag', 'false'));
            writeLine('    ' + element('online-flag', (vr.onlineFlag || 'true').toLowerCase()));
            writeLine('    ' + element('available-flag', 'true'));
            writeLine('    ' + element('searchable-flag', (vr.searchableFlag || 'true').toLowerCase()));
            writeLine('    ' + element('tax-class-id', vr.TaxClass || 'Standard'));

            // ADD brand for variants (keeps behavior consistent with request)
            writeLine('    ' + element('brand', vr.brand || ''));

            // PAGE ATTRIBUTES FOR VARIANT
            var vHasPageTitle = vr.pageTitle && vr.pageTitle.trim() !== '';
            var vHasPageDesc = vr.pageDescription && vr.pageDescription.trim() !== '';

            if (vHasPageTitle || vHasPageDesc) {
                writeLine('    <page-attributes>');
                if (vHasPageTitle) {
                    writeLine('      <page-title xml:lang="x-default">' + wrapValue(vr.pageTitle) + '</page-title>');
                }
                if (vHasPageDesc) {
                    writeLine('      <page-description xml:lang="x-default">' + wrapValue(vr.pageDescription) + '</page-description>');
                }
                writeLine('    </page-attributes>');
            } else {
                writeLine('    <page-attributes/>');
            }


            writeLine('    <custom-attributes>');
            ['color', 'size', 'material', 'discountPercentage', 'weight', 'weightUnit'].forEach(function (f) {
                if (vr[f]) {
                    writeLine('      <custom-attribute attribute-id="' + f + '">' + wrapValue(vr[f]) + '</custom-attribute>');
                }
            });

            if (vr.returnAnExchange) {
                writeLine('      <custom-attribute attribute-id="returnAnExchange">' + wrapValue(vr.returnAnExchange) + '</custom-attribute>');
            }
            if (vr.tags) {
                var tagsBlock2 = buildTagList(vr.tags);
                if (tagsBlock2) {
                    var tt = tagsBlock2.split('\n');
                    for (var tti = 0; tti < tt.length; tti++) writeLine(tt[tti]);
                }
            }
            Object.keys(vr).forEach(function (key) {
                if (systemFields.indexOf(key) === -1 &&
                    !['color', 'size', 'material', 'discountPercentage', 'weight', 'weightUnit', 'returnAnExchange', 'onlineFlag', 'searchableFlag', 'onlineFrom', 'onlineTo', 'tags', 'images', 'imageAlt', 'imageTitle']
                        .includes(key) && vr[key]) {

                    writeLine('      <custom-attribute attribute-id="' + key + '">' + wrapValue(vr[key]) + '</custom-attribute>');
                }
            });
            writeLine('    </custom-attributes>');

            writeLine('    <classification-category catalog-id="sotbella-in-storefront">' + wrapValue(vr.category || '') + '</classification-category>');
            writeLine('    <pinterest-enabled-flag>false</pinterest-enabled-flag>');
            writeLine('    <facebook-enabled-flag>false</facebook-enabled-flag>');
            writeLine('    <store-attributes>');
            writeLine('      <force-price-flag>false</force-price-flag>');
            writeLine('      <non-inventory-flag>false</non-inventory-flag>');
            writeLine('      <non-revenue-flag>false</non-revenue-flag>');
            writeLine('      <non-discountable-flag>false</non-discountable-flag>');
            writeLine('    </store-attributes>');

            writeLine('  </product>');
        });

        writeLine('</catalog>');

        fw.close();

        return new Status(Status.OK, 'OK', 'Catalog XML generated');
    } catch (e) {
        Logger.error('ERROR generating catalog: ' + e);
        return new Status(Status.ERROR, 'ERROR', e.message);
    }
};

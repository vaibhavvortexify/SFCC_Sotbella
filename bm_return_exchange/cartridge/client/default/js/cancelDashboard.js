'use strict';
(function ($) {
$(function () {
    var activeItemUUID = null;

    // 1. Initial State Configuration
    var config = {
        tabStatus: window.initialConfig ? window.initialConfig.tabStatus : 'cancelled',
        url: window.dashboardUrl
    };

    console.log('Cancel Dashboard JS Initialized');

    // --- Core Functions ---

    function refreshData() {
        var startDate = $('#fromDate').val();
        var endDate = $('#toDate').val();

        $.ajax({
            url: config.url,
            data: {
                startDate: startDate,
                endDate: endDate,
                tabStatus: config.tabStatus,
                format: 'ajax'
            },
            method: 'GET',
            success: function (response) {
                renderTable(response.items);
                closeHandler(); // Ensure detail view closes and view resets on refresh
            },
            error: function () {
                alert('Failed to refresh data. Please check your connection.');
            }
        });
    }

    /**
     * Renders the Cancel Table rows dynamically
     */
    function renderTable(items) {
        var $tbody = $('#cancel-table-body');
        $tbody.empty();

        if (!items || items.length === 0) {
            $tbody.append('<tr><td colspan="6" class="text-center py-4 text-muted">No cancellation records found.</td></tr>');
            return;
        }

        items.forEach(function (item) {
            // Escape single quotes to prevent breaking the HTML attribute string
            var itemJson = JSON.stringify(item).replace(/'/g, "&apos;");

            var row = '<tr class="cancel-row" style="cursor:pointer;" ' +
                'data-order="' + item.orderNo + '" ' +
                'data-uuid="' + item.lineItemId + '" ' +
                'data-item-json=\'' + itemJson + '\'>' +
                '<td>' + item.sku + '</td>' +
                '<td>' +
                '<div class="d-flex align-items-center">' +
                '<div class="px-2">' +
                '<img src="' + item.productImage + '" class="img-thumbnail" style="width: 50px; height: 50px;" />' +
                '</div>' +
                '<div>' +
                '<div class="fw-bold">' + item.productName + '</div>' +
                '<div class="small text-muted">Qty: ' + item.quantity + ' | Price: ' + item.currencySymbol + item.singlePrice + '</div>' +
                '</div>' +
                '</div>' +
                '</td>' +
                '<td>' + item.customerEmail + '</td>' +
                '<td>' + item.orderNo + '</td>' +
                '<td>' + item.creationDate + '</td>' +
                '<td><span class="badge rounded-pill bg-dark">' + (item.displayStatus || 'Cancelled') + '</span></td>' +
                '</tr>';

            $tbody.append(row);
        });
    }

    function closeHandler() {
        $('#list-view').removeClass('d-none');
        $('#detail-view').addClass('d-none');
        $('#btn-back-list').addClass('d-none'); // Hide the back button in list view
        activeItemUUID = null;
    }

    // --- Event Listeners ---

    // Tab Navigation
    $('.tab').on('click', function (e) {
        e.preventDefault();
        $('.tab').removeClass('active');
        $(this).addClass('active');
        config.tabStatus = $(this).data('status').toLowerCase();
        refreshData();
    });

    // Row Click: Open Detail View
    $(document).on('click', '.cancel-row', function (e) {
        var $row = $(this);
        var itemData = $row.data('item-json');
        activeItemUUID = $row.data('uuid');

        if (!itemData) return;

        // Switch Visibility
        $('#list-view').addClass('d-none');
        $('#detail-view').removeClass('d-none');
        $('#btn-back-list').removeClass('d-none');

        // Populate Cancellation Date (using your new attribute)
        $('#det-cancel-req-date').text(itemData.cancellationDate || itemData.creationDate);

        // Item Details
        $('#det-cancel-item-price').text(itemData.currencySymbol + itemData.singlePrice);
        $('#det-cancel-item-qty').text(itemData.quantity);
        $('#det-cancel-desc').text(itemData.description || 'No description provided.');

        // Full Customer Details
        $('#det-cancel-cust-name').text(itemData.customerName || 'N/A');
        $('#det-cancel-cust-phone').text(itemData.customerPhone ? ('+' + itemData.customerPhone) : 'N/A');
        $('#det-cancel-cust-addr').text(itemData.orderAddress || 'N/A');

        // Populate Common Header/Customer Info
        $('#det-cancel-order').text(itemData.orderNo);
        $('#det-cancel-req-date').text(itemData.creationDate);
        $('#det-cancel-cust-email').text(itemData.customerEmail);
        $('#det-cancel-payment-method').text(itemData.paymentMethod);

        // Populate Item info
        $('#cancel-detail-img').attr('src', itemData.productImage);
        $('#det-cancel-item-name').text(itemData.productName);
        $('#det-cancel-refund-amount').text(itemData.currencySymbol + itemData.finalPrice.toFixed(2));
        $('#det-cancel-reason').text(itemData.cancelReason || 'Customer Request');

        // NEW: Populate Inventory Status in Detail
        $('#det-can-inventory-status').text(itemData.returnInventoryStatus || 'Pending');

        // Populate Bank Info
        $('#det-can-bank-name').text(itemData.BankName);
        $('#det-can-bank-acc').text(itemData.BankAccountNumber);
        $('#det-can-bank-ifsc').text(itemData.BankifscCode);
        $('#det-can-bank-mobile').text(itemData.BankMobileNumber || 'N/A');

        // Refund UI logic
        if (config.tabStatus === 'refunded') {
            $('#cancel-refund-form-container').addClass('d-none');
            $('#cancel-refund-already-processed').removeClass('d-none');
        } else {
            $('#cancel-refund-form-container').removeClass('d-none');
            $('#cancel-refund-already-processed').addClass('d-none');
            $('#input-cancel-refund-amount').val(itemData.finalPrice.toFixed(2));
        }

        // Reset bank details state
        $('#can-bank-details-container').addClass('d-none');
        $('#select-cancel-refund-method').val('');
    });

    // Refund Method Toggle (Bank Details)
    $(document).on('change', '#select-cancel-refund-method', function () {
        if ($(this).val() === 'BANK_TRANSFER') {
            $('#can-bank-details-container').removeClass('d-none');
        } else {
            $('#can-bank-details-container').addClass('d-none');
        }
    });

    // Process Refund Button Click
    $(document).on('click', '#btn-process-cancel-refund', function () {
        var refundAmount = $('#input-cancel-refund-amount').val();
        var refundMethod = $('#select-cancel-refund-method').val();
        var $btn = $(this);

        if (!refundAmount || !refundMethod) {
            alert('Please enter an amount and select a method.');
            return;
        }

        if (!confirm('Confirm refund of ' + refundAmount + ' via ' + refundMethod + '?')) {
            return;
        }

        var requestData = {
            orderNo: $('#det-cancel-order').text(),
            lineItemId: activeItemUUID,
            amount: refundAmount,
            paymentMethod: refundMethod
        };

        $btn.prop('disabled', true).text('Processing...');

        $.ajax({
            url: window.processRefundUrl,
            method: 'POST',
            data: requestData,
            success: function (data) {
                if (data.success) {
                    alert('Cancellation refund processed successfully');
                    refreshData();
                } else {
                    alert('Error: ' + data.message);
                    $btn.prop('disabled', false).text('Complete Refund');
                }
            },
            error: function () {
                alert('Network error during refund processing');
                $btn.prop('disabled', false).text('Complete Refund');
            }
        });
    });

    // FIX: Standardized Filter Button Listener
    // Added multiple selectors to ensure it catches whatever ID is in your dashboard.isml
    $('#btn-apply-filter, #btn-apply-cancel-filter').on('click', function (e) {
        e.preventDefault();
        refreshData();
    });

    $('#btn-close-cancel, #btn-back-list, #btn-back-cancel-list').on('click', function (e) {
        e.preventDefault();
        closeHandler();
    });

    $(document).on('click', '#btn-download-cancel-csv', function (e) {
        e.preventDefault();
        var $btn = $(this);

        var currentItems = [];
        // Scrape data from cancellation table rows
        $('.cancel-row').each(function () {
            var rowData = $(this).data('item-json');
            if (rowData) {
                var cleanObj = {};
                // Filter out internal/binary keys to keep the CSV clean
                Object.keys(rowData).forEach(function (key) {
                    if (['productImage', 'mediaLinks', 'exchangeItemDetails'].indexOf(key) === -1) {
                        cleanObj[key] = rowData[key];
                    }
                });
                currentItems.push(cleanObj);
            }
        });

        if (currentItems.length === 0) {
            alert("No cancellation data found to download.");
            return;
        }

        var fileName = "Cancellations_" + config.tabStatus + ".csv";
        $btn.prop('disabled', true).text('Generating...');

        $.ajax({
            url: window.downloadCsvUrl,
            method: 'POST',
            data: { csvData: JSON.stringify(currentItems) },
            xhrFields: { responseType: 'blob' },
            success: function (data) {
                console.log('CSV data received from server');

                try {
                    // Force the response data into a Blob even if jQuery didn't process it correctly
                    var blob = new Blob([data], { type: 'text/csv' });

                    // Create the download link
                    var url = window.URL || window.webkitURL;
                    var downloadUrl = url.createObjectURL(blob);

                    var a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = fileName; // Ensure fileName is defined in your scope

                    document.body.appendChild(a);
                    a.click();

                    // Cleanup
                    setTimeout(function () {
                        document.body.removeChild(a);
                        url.revokeObjectURL(downloadUrl);
                    }, 100);

                    console.log('Download triggered successfully.');
                } catch (e) {
                    console.error('Error in blob creation:', e);
                    alert('Browser failed to process the file download.');
                }
            },
            error: function () {
                alert('Export failed.');
            },
            complete: function () {
                $btn.prop('disabled', false).html('<i class="fa fa-download"></i> Download CSV');
            }
        });
    });
});
})(jQuery);
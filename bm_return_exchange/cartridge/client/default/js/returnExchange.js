'use strict';
(function ($) {
$(function () {
    var activeItemUUID = null;
    // 1. Initial State Configuration
    var config = {
        isReturn: window.initialConfig ? window.initialConfig.isReturn : true,
        tabStatus: window.initialConfig ? window.initialConfig.tabStatus : 'requested',
        url: window.dashboardUrl
    };

    console.log('Return Exchange JS Initialized');

    // --- Core Functions ---

    function refreshData() {
        var startDate = $('#fromDate').val();
        var endDate = $('#toDate').val();

        $.ajax({
            url: config.url,
            data: {
                startDate: startDate,
                endDate: endDate,
                isReturn: config.isReturn,
                tabStatus: config.tabStatus,
                format: 'ajax'
            },
            method: 'GET',
            success: function (response) {
                renderTable(response.items);
                // // Optional: Update inputs if server returns different dates
                // if (response.startDate) $('#fromDate').val(response.startDate);
                // if (response.endDate) $('#toDate').val(response.endDate);
                closeHandler(); // Ensure detail view closes when data refreshes
            }
        });
    }

    /**
 * Renders the table body to match the updated ISML (including product images)
 * @param {Array} items - Array of item objects from the controller
 */
    function renderTable(items) {
        var $tbody = $('#data-table-body');
        $tbody.empty();

        if (!items || items.length === 0) {
            $tbody.append('<tr><td colspan="5" class="text-center py-4 text-muted">No records found.</td></tr>');
            return;
        }

        items.forEach(function (item) {
            // Fix: Standardize on hyphenated 'data-item-json'
            // We escape single quotes to prevent breaking the HTML attribute string
            var itemJson = JSON.stringify(item).replace(/'/g, "&apos;");

            var row = '<tr class="data-row" style="cursor:pointer;" ' +
                'data-order="' + item.orderNo + '" ' +
                'data-status="' + item.status + '" ' +
                'data-uuid="' + item.lineItemId + '" ' +
                'data-item-json=\'' + itemJson + '\'>' +

                '<td>' + item.sku + '</td>' +
                '<td>' +
                '<div class="d-flex align-items-center">' +
                '<div class="item-detail-image px-2">' +
                '<img src="' + item.productImage + '" alt="' + item.productName + '" class="img-thumbnail rounded p-0" style="width: 50px; height: 50px;" />' +
                '</div>' +
                '<div class="item-detail-text">' +
                '<div class="fw-bold">' + item.productName + '</div>' +
                '<div class="small text-muted">Qty: ' + item.quantity + ' | Price: ' + item.currencySymbol + item.singlePrice + '</div>' +
                '</div>' +
                '</div>' +
                '</td>' +
                '<td>' + item.customerEmail + '</td>' +
                '<td>' + item.orderNo + '</td>' +
                '<td>' + item.creationDate + '</td>' +
                '<td><span class="badge rounded-pill bg-secondary">' + (item.displayStatus || 'N/A') + '</span></td>' +
                '</tr>';

            $tbody.append(row);
        });
    }

    // --- Event Listeners ---

    // Tab Logic
    $('.tab').on('click', function () {
        $('.tab').removeClass('active');
        $(this).addClass('active');
        config.tabStatus = $(this).data('status').toLowerCase();
        refreshData();
    });

    // Module Logic
    $('.nav-btn').on('click', function () {
        $('.nav-btn').removeClass('active');
        $(this).addClass('active');
        config.isReturn = ($(this).data('module') === 'Return');

        // Update Dynamic Tab (Text AND Data Value)
        var $dynamicTab = $('#tab-dynamic');

        if (config.isReturn) {
            $dynamicTab.text('Returned');
            $dynamicTab.data('status', 'returned'); // Set status to 'returned'
            $dynamicTab.attr('data-status', 'returned'); // Update DOM attribute for consistency
        } else {
            $dynamicTab.text('Exchanged');
            $dynamicTab.data('status', 'exchanged'); // Set status to 'exchanged'
            $dynamicTab.attr('data-status', 'exchanged'); // Update DOM attribute for consistency
        }

        // Reset to default 'requested' tab when switching modules
        $('.tab').removeClass('active');
        $('.tab[data-status="requested"]').addClass('active');
        config.tabStatus = 'requested';

        refreshData();
    });

    // FIX: Row Click Delegation & Detail Population
    $(document).on('click', '.data-row', function (e) {
        e.preventDefault();
        var $row = $(this);

        // FIX: Match the attribute name used in ISML (item-json)
        var itemData = $row.data('item-json');
        console.log(itemData);

        activeItemUUID = $row.data('uuid');

        if (!itemData) {
            console.error("No item data found for this row");
            return;
        }

        // Switch Visibility (Using Bootstrap d-none)
        $('#list-view').addClass('d-none');
        $('#detail-view').removeClass('d-none hidden');
        $('#btn-back-list').removeClass('d-none hidden');

        // Populate Bank Details (Hidden by default until method selected)
        $('#det-bank-name').text(itemData.BankName);
        $('#det-bank-acc').text(itemData.BankAccountNumber);
        $('#det-bank-ifsc').text(itemData.BankifscCode);
        $('#det-bank-mobile').text(itemData.BankMobileNumber);
        $('#bank-details-container').addClass('d-none');

        $('#ex-det-bank-name').text(itemData.BankName);
        $('#ex-det-bank-acc').text(itemData.BankAccountNumber);
        $('#ex-det-bank-ifsc').text(itemData.BankifscCode);
        $('#ex-det-bank-mobile').text(itemData.BankMobileNumber);
        $('#ex-bank-details-container').addClass('d-none');

        $('#select-refund-method, #ex-select-refund-method').val('');


        // Reset both containers
        $('#rejection-reason-container, #ex-rejection-reason-container').addClass('d-none');
        $('#rejection-input-block, #ex-rejection-input-block').addClass('d-none');
        $('#rejection-display-block, #ex-rejection-display-block').addClass('d-none');

        if (config.tabStatus === 'requested') {
            // Show Input for both modules
            var container = config.isReturn ? '#rejection-reason-container' : '#ex-rejection-reason-container';
            var inputBlock = config.isReturn ? '#rejection-input-block' : '#ex-rejection-input-block';

            $(container).removeClass('d-none');
            $(inputBlock).removeClass('d-none');
            $('#return-reject-reason-input, #ex-reject-reason-input').val(''); // Clear previous input
        }
        else if (config.tabStatus === 'rejected') {
            // Show Saved Reason for both modules
            var container = config.isReturn ? '#rejection-reason-container' : '#ex-rejection-reason-container';
            var displayBlock = config.isReturn ? '#rejection-display-block' : '#ex-rejection-display-block';
            var textField = config.isReturn ? '#det-rejection-reason-text' : '#det-ex-rejection-reason-text';

            $(container).removeClass('d-none');
            $(displayBlock).removeClass('d-none');
            $(textField).text(itemData.requestRejectReason || 'No reason specified');
        }

        if (config.isReturn) {

            // Reset Refund UI
            $('#refund-processing-section').addClass('d-none');
            $('#refund-already-processed').addClass('d-none');
            $('#refund-form-container').removeClass('d-none');
            $('#standard-total-display').removeClass('d-none');

            // Logic for the 'Returned' status
            if (config.tabStatus === 'returned') {
                $('#standard-total-display').addClass('d-none'); // Hide simple text
                $('#refund-processing-section').removeClass('d-none'); // Show refund UI

                // Set pre-filled value for refund amount
                $('#input-refund-amount').val(itemData.finalPrice.toFixed(2));

                // Check if the item is already refunded (Status 27: RETURNED AND REFUNDED)
                // Adjust '27' if your lineItemStatusJSON uses a different ID
                if (itemData.status === 27) {
                    $('#refund-form-container').addClass('d-none');
                    $('#refund-already-processed').removeClass('d-none');
                }
            } else {
                // Normal view for Requested/Approved/Rejected
                $('#det-total-refund').text(itemData.currencySymbol + (itemData.finalPrice).toFixed(2));
            }

            // Populate Common Header
            $('#det-order').text(itemData.orderNo);
            $('#det-status').text(config.tabStatus.toUpperCase());
            $('#det-delivered-date').text(itemData.deliveredDate || 'Not Delivered Yet');
            $('#det-requested-date').text(itemData.returnExchangeRequestDate || '00-00-0000');

            // Populate Detail Grid
            $('#detail-info-img').attr('src', itemData.productImage);
            $('#detail-info-img').attr('alt', itemData.productName);
            $('#det-item-name').text(itemData.productName);
            // $('#det-item-price').text(itemData.currencySymbol + (itemData.finalPrice / itemData.quantity).toFixed(2))   ;
            $('#det-item-price').text(itemData.currencySymbol + itemData.singlePrice);
            $('#det-item-qty').text(itemData.quantity);
            $('#det-total-refund').text(itemData.currencySymbol + (itemData.finalPrice).toFixed(2));

            $('#det-reason').text(itemData.reason || 'N/A');
            $('#det-desc').text(itemData.description || 'No description provided');
            $('#det-cust-name').text(itemData.customerName || 'N/A');
            $('#det-cust-phone').text(itemData.customerPhone ? ('+' + itemData.customerPhone) : 'N/A');
            $('#det-cust-email').text(itemData.customerEmail);
            $('#det-cust-addr').text(itemData.orderAddress || 'N/A');
            $('#det-payment-method').text(itemData.paymentMethod);

            // Handle Media/Uploads
            // Inside the row click listener where you populate details
            var $mediaTiles = $('#det-media-tiles').empty();
            if (itemData.mediaLinks) {
                // Handle comma-separated strings if necessary
                var links = Array.isArray(itemData.mediaLinks) ? itemData.mediaLinks : itemData.mediaLinks.split(',');

                links.forEach(function (link) {
                    link = link.trim();
                    if (!link) return;

                    // Detect extension
                    var ext = link.split('.').pop().toLowerCase();
                    var isVideo = ['mp4', 'webm', 'ogg', 'mov'].indexOf(ext) > -1;

                    var tileHtml = '<div class="media-tile border rounded overflow-hidden bg-light" style="width: 80px; height: 80px; position: relative;">';

                    if (isVideo) {
                        tileHtml += '<video src="' + link + '" style="width: 100%; height: 100%; object-fit: cover;"></video>';
                        tileHtml += '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none;">' +
                            '<span class="badge bg-dark opacity-75">▶</span></div>';
                    } else {
                        tileHtml += '<img src="' + link + '" alt="Upload" style="width: 100%; height: 100%; object-fit: cover;" />';
                    }

                    tileHtml += '<a href="' + link + '" target="_blank" class="stretched-link"></a></div>';

                    $mediaTiles.append(tileHtml);
                });
            } else {
                $mediaTiles.html('<span class="text-muted small">No media uploaded</span>');
            }

            // Action Buttons Visibility
            if (config.tabStatus === 'requested') {
                $('#action-buttons').removeClass('d-none');
            } else {
                $('#action-buttons').addClass('d-none');
            }

            $('#container-return-detail').removeClass('d-none');
            $('#container-exchange-detail').addClass('d-none');

            $('#det-inventory-status').text(itemData.returnInventoryStatus);
        } else {
            // 1. Reset Visibility
            $('#ex-refund-section').addClass('d-none');
            $('#ex-refund-already-processed').addClass('d-none');
            $('#ex-refund-form-container').removeClass('d-none');
            $('#ex-refund-currency').text(itemData.currencySymbol || '$');

            // 2. Logic for 'Rejected' (Positive Balance) and 'Exchanged' (Negative Balance)
            if (config.tabStatus === 'rejected' || config.tabStatus === 'exchanged') {
                var exAmt = parseFloat(itemData.exchangeAmount) || 0;
                var showRefundBlock = false;
                var prefillValue = 0;

                if (config.tabStatus === 'rejected') {
                    showRefundBlock = true;
                    prefillValue = exAmt; // Refund what they paid extra
                } else if (config.tabStatus === 'exchanged') {
                    showRefundBlock = true;
                    prefillValue = Math.abs(exAmt); // Refund the difference
                }

                if (itemData.status === 29 || itemData.status == 28) showRefundBlock = false;

                if (showRefundBlock) {
                    $('#ex-refund-section').removeClass('d-none');
                    $('#ex-input-refund-amount').val(prefillValue.toFixed(2));

                    // Check if already refunded (Status 27 or 28)
                    if (itemData.status === 27 || itemData.status === 28) {
                        $('#ex-refund-form-container').addClass('d-none');
                        $('#ex-refund-already-processed').removeClass('d-none');
                    }
                }
            }

            // Populate Exchange Header
            $('#det-ex-order').text(itemData.orderNo);
            $('#det-ex-status').text(config.tabStatus.toUpperCase());
            $('#det-ex-delivered-date').text(itemData.deliveredDate || 'Not Delivered Yet');
            $('#det-ex-requested-date').text(itemData.returnExchangeRequestDate || '00-00-0000');

            // Populate LEFT Box (Original Item)
            $('#det-ex-orig-name').text(itemData.productName);
            $('#det-ex-orig-qty').text(itemData.quantity);
            $('#det-ex-orig-price').text(itemData.currencySymbol + itemData.singlePrice);
            if (itemData.productImage) {
                $('#det-ex-orig-img').attr('src', itemData.productImage).show();
            }
            $('#det-ex-cust-addr').text(itemData.orderAddress || 'N/A');
            $('#det-ex-payment-method').text(itemData.paymentMethod);

            // Populate RIGHT Box (Exchange For Item)
            if (itemData.exchangeItemDetails) {
                $('#det-ex-new-name').text(itemData.exchangeItemDetails.name);
                $('#det-ex-new-qty').text(itemData.exchangeItemDetails.quantity);
                $('#det-ex-new-price').text(itemData.currencySymbol + itemData.exchangeItemDetails.price);
                if (itemData.exchangeItemDetails.image) {
                    $('#det-ex-new-img').attr('src', itemData.exchangeItemDetails.image).show();
                } else {
                    $('#det-ex-new-img').hide();
                }
            } else {
                $('#det-ex-new-name').text("Pending Selection");
                $('#det-ex-new-price').text("--");
                $('#det-ex-new-img').hide();
            }

            // Populate Common Meta Data
            $('#det-ex-reason').text(itemData.reason || 'N/A');
            $('#det-ex-desc').text(itemData.description || '-');
            $('#det-ex-cust-name').text(itemData.customerName || 'N/A');
            $('#det-ex-cust-email').text(itemData.customerEmail);
            $('#det-ex-cust-phone').text(itemData.customerPhone ? ('+' + itemData.customerPhone) : 'N/A');

            // Populate Media
            // Populate Media (Updated to render Tiles)
            var $mediaTiles = $('#det-ex-media-tiles').empty();
            if (itemData.mediaLinks) {
                var links = Array.isArray(itemData.mediaLinks) ? itemData.mediaLinks : itemData.mediaLinks.split(',');

                links.forEach(function (link) {
                    link = link.trim();
                    if (!link) return;

                    var ext = link.split('.').pop().toLowerCase();
                    var isVideo = ['mp4', 'webm', 'ogg', 'mov'].indexOf(ext) > -1;

                    var tileHtml = '<div class="media-tile border rounded overflow-hidden bg-light" style="width: 80px; height: 80px; position: relative;">';

                    if (isVideo) {
                        tileHtml += '<video src="' + link + '" style="width: 100%; height: 100%; object-fit: cover;"></video>';
                        tileHtml += '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none;">' +
                            '<span class="badge bg-dark opacity-75">▶</span></div>';
                    } else {
                        tileHtml += '<img src="' + link + '" alt="Upload" style="width: 100%; height: 100%; object-fit: cover;" />';
                    }

                    tileHtml += '<a href="' + link + '" target="_blank" class="stretched-link"></a></div>';
                    $mediaTiles.append(tileHtml);
                });
            }

            // Check if empty after processing
            if ($mediaTiles.children().length === 0) {
                $mediaTiles.html('<span class="text-muted small">No media uploaded</span>');
            }

            // Action Buttons Visibility
            if (config.tabStatus === 'requested') {
                $('#ex-action-buttons').removeClass('d-none');
            } else {
                $('#ex-action-buttons').addClass('d-none');
            }

            $('#container-return-detail').addClass('d-none');
            $('#container-exchange-detail').removeClass('d-none');

            $('#det-ex-inventory-status').text(itemData.returnInventoryStatus);
        }


    });

    function closeHandler() {
        $('#list-view').removeClass('d-none');
        $('#detail-view').addClass('d-none');
        $('#btn-back-list').addClass('d-none');
        activeItemUUID = null;
    }

    $('#btn-close-detail, #btn-close-ex-detail, #btn-back-list').on('click', closeHandler);

    $('#btn-apply-filter').on('click', refreshData);

    $(document).on('click', '#btn-approve, #ex-action-buttons .btn-primary', function (e) {
        var $btn = $(this);
        // Assuming you stored the active item's data in a variable when the row was clicked
        var currentOrderNo = config.isReturn ? $('#det-order').text() : $('#det-ex-order').text();
        var requestData = {
            orderNo: currentOrderNo,
            lineItemId: activeItemUUID, // You should capture this when opening the detail view
            isReturn: config.isReturn
        };

        console.log('Approving Request:', requestData);

        $btn.prop('disabled', true).text('Processing...');

        $.ajax({
            url: window.acceptRequestUrl, // Define this in your dashboard.isml using URLUtils
            method: 'POST',
            data: requestData,
            success: function (data) {
                if (data.success) {
                    alert('Request Approved Successfully');
                    activeItemUUID = null;
                    closeHandler(); // Close detail view
                    refreshData();  // Re-run your AJAX table fetch
                } else {
                    alert('Error: ' + data.message);
                }
            },
            error: function () {
                alert('Network error while approving request');
            },
            complete: function () {
                $btn.prop('disabled', false).text('Approve Request');
            }
        });
    });


    $(document).on('click', '#btn-reject, #ex-action-buttons .btn-danger', function (e) {
        var $btn = $(this);
        var rejectReason = config.isReturn ? $('#return-reject-reason-input').val() : $('#ex-reject-reason-input').val();

        if (!rejectReason || rejectReason.trim() === '') {
            alert('Please provide a reason for rejection.');
            return;
        }

        if (!activeItemUUID) {
            alert('Error: No item selected.');
            return;
        }

        if (!confirm('Are you sure you want to REJECT this request?')) {
            return;
        }
        var currentOrderNo = config.isReturn ? $('#det-order').text() : $('#det-ex-order').text();
        var requestData = {
            orderNo: currentOrderNo,
            lineItemId: activeItemUUID,
            isReturn: config.isReturn,
            rejectReason: rejectReason
        };

        $btn.prop('disabled', true).text('Rejecting...');

        $.ajax({
            url: window.rejectRequestUrl, // URLUtils.url('ReturnDashboard-RejectRequest')
            method: 'POST',
            data: requestData,
            success: function (data) {
                if (data.success) {
                    alert('Request Rejected');
                    activeItemUUID = null;
                    closeHandler();
                    refreshData();
                } else {
                    alert('Error: ' + data.message);
                }
            },
            error: function () {
                alert('Network error while rejecting request');
            },
            complete: function () {
                $btn.prop('disabled', false).text('Reject Request');
            }
        });
    });

    $(document).on('click', '#btn-process-refund', function (e) {
        var refundAmount = $('#input-refund-amount').val();
        var refundMethod = $('#select-refund-method').val();

        if (!refundAmount || !refundMethod) {
            alert('Please enter an amount and select a refund method.');
            return;
        }

        if (!confirm('Confirm refund of ' + refundAmount + ' via ' + refundMethod + '?')) {
            return;
        }

        var requestData = {
            orderNo: config.isReturn ? $('#det-order').text() : $('#det-ex-order').text(),
            lineItemId: activeItemUUID,
            isReturn: config.isReturn,
            amount: refundAmount,
            paymentMethod: refundMethod
        };

        $(this).prop('disabled', true).text('Processing...');

        $.ajax({
            url: window.processRefundUrl,
            method: 'POST',
            data: requestData,
            success: function (data) {
                if (data.success) {
                    alert('Refund processed successfully');
                    activeItemUUID = null;
                    closeHandler();
                    refreshData();
                } else {
                    alert('Error processing refund: ' + data.message);
                }
            },
            error: function () {
                alert('Network error during refund processing');
            },
            complete: function () {
                $('#btn-process-refund').prop('disabled', false).text('Process Refund');
            }
        });
    });

    $(document).on('click', '#ex-btn-process-refund', function (e) {
        var refundAmount = $('#ex-input-refund-amount').val();
        var refundMethod = $('#ex-select-refund-method').val();

        if (!refundAmount || !refundMethod) {
            alert('Please provide refund amount and method.');
            return;
        }

        if (!confirm('Confirm refund of ' + refundAmount + ' via ' + refundMethod + '?')) {
            return;
        }

        var requestData = {
            orderNo: $('#det-ex-order').text(),
            lineItemId: activeItemUUID,
            amount: refundAmount,
            paymentMethod: refundMethod,
            isReturn: false
        };

        $(this).prop('disabled', true).text('Processing...');

        $.ajax({
            url: window.processRefundUrl,
            method: 'POST',
            data: requestData,
            success: function (data) {
                if (data.success) {
                    alert('Exchange refund processed successfully');
                    activeItemUUID = null;
                    closeHandler();
                    refreshData();
                } else {
                    alert('Error processing refund: ' + data.message);
                }
            },
            error: function () {
                alert('Network error during exchange refund');
            },
            complete: function () {
                $('#ex-btn-process-refund').prop('disabled', false).text('Process Exchange Refund');
            }
        });
    });

    // Listener for Return Dropdown
    $(document).on('change', '#select-refund-method', function () {
        if ($(this).val() === 'BANK_TRANSFER') {
            $('#bank-details-container').removeClass('d-none');
        } else {
            $('#bank-details-container').addClass('d-none');
        }
    });

    // Listener for Exchange Dropdown
    $(document).on('change', '#ex-select-refund-method', function () {
        if ($(this).val() === 'BANK_TRANSFER') {
            $('#ex-bank-details-container').removeClass('d-none'); // Targeting the new ID
        } else {
            $('#ex-bank-details-container').addClass('d-none');
        }
    });

    // --- Missing Helper Definition (Added to prevent script crashes) ---
    function handleBankDetailsToggle(selector) {
        $(document).on('change', selector, function () {
            var targetId = (selector.indexOf('ex-') > -1) ? '#ex-bank-details-container' : '#bank-details-container';
            if ($(this).val() === 'BANK_TRANSFER') {
                $(targetId).removeClass('d-none');
            } else {
                $(targetId).addClass('d-none');
            }
        });
    }

    // Initialize for both Return and Exchange dropdowns
    handleBankDetailsToggle('#select-refund-method');
    handleBankDetailsToggle('#ex-select-refund-method');

    $(document).on('click', '#btn-download-csv', function (e) {
        e.preventDefault();
        var $btn = $(this);

        var currentItems = [];
        $('.data-row').each(function () {
            var rowData = $(this).data('item-json');
            if (rowData) {
                // Create a clean data object for the CSV
                var cleanObj = {};
                Object.keys(rowData).forEach(function (key) {
                    // Remove binary/image data that isn't needed in a spreadsheet
                    if (['productImage', 'mediaLinks', 'exchangeItemDetails'].indexOf(key) === -1) {
                        cleanObj[key] = rowData[key];
                    }
                });
                currentItems.push(cleanObj);
            }
        });

        if (currentItems.length === 0) {
            alert("No data found to download.");
            return;
        }

        var fileName = (config.isReturn ? "Returns_" : "Exchanges_") + config.tabStatus + ".csv";
        $btn.prop('disabled', true).text('Generating...');

        $.ajax({
            url: window.downloadCsvUrl,
            method: 'POST',
            data: { csvData: JSON.stringify(currentItems) },
            xhrFields: { responseType: 'blob' },
            success: function (blob) {
                var url = window.URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            },
            error: function () { alert('Export failed.'); },
            complete: function () { $btn.prop('disabled', false).html('<i class="fa fa-download"></i> Download CSV'); }
        });
    });
});
})(jQuery);
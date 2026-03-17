'use strict';

var server = require('server');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');

//Sample Response
// {
// 	email_id: 'test@yop.com',
// 	login_id: 'test@yop.com',
// 	phone: '9876543219',
// 	customer_id: 'ab3jGnmseoLZmjcuTJjUNUiIfE',
// 	locale: 'en-us',
// 	token: '95815826',
// };

server.post('Callback', function (req, res, next) {
	var currentLocale = req.locale.id;
	var marketingAuthService = require('*/cartridge/services/marketingAuth.js');
	var marketingEmailService = require('*/cartridge/services/marketingSendEmail.js');
	var PasswordLessTokenHelper = require('*/cartridge/scripts/helpers/PasswordLessTokenHelper.js')
	var token = null;
	var loginId = null;
	var requestBody = {};
	var locale = null;
	var siteId = Site.getCurrent().getID();
	if (req.body) {
		try {
			requestBody = JSON.parse(req.body);
			token = requestBody.token;
			loginId = requestBody.login_id;
			locale = requestBody.locale;
		} catch (e) {
			res.setStatusCode(400);
			res.json({
				error: true,
				message: 'Invalid JSON payload.',
			});
			return next();
		}
	}

	if (currentLocale.replace('_', '-') !== locale) {
		Logger.error('Locales doesnt match: {0} and {1}.', currentLocale, locale);
		res.setStatusCode(400);
		res.json({
			error: true,
			message: 'Invalid JSON payload.',
		});
		return next();
	}

	if (!token || !loginId || !locale) {
		res.setStatusCode(400);
		res.json({
			error: true,
			message: 'Invalid JSON payload.',
		});
		return next();
	}

	try {
		const emailRegexString = Site.current.getCustomPreferenceValue('emailRegex');
		const phoneRegexString = Site.current.getCustomPreferenceValue('phoneNumberRegex');

		const emailRegex = emailRegexString ? new RegExp(emailRegexString) : null;
		const phoneNumberRegex = phoneRegexString ? new RegExp(phoneRegexString) : null;

		if (!emailRegex || !phoneNumberRegex) {
			Logger.error('No Email or Phone regex found');
			res.json({
				error: true,
				message: 'No Email or Phone regex found',
				details: { error: 'No Email or Phone regex found' },
			});
			return next();
		}

		var currentSitePref = Site.getCurrent().getPreferences().getCustom();
		var clientId = currentSitePref.marketingCloudClientId;
		var clientSecret = currentSitePref.marketingCloudClientSecret;
		var sitePrefLocale = currentSitePref.locale;
		var finalLocale = sitePrefLocale ? sitePrefLocale : locale;
		var definitionKey;
		var apiBody;
		//Generate And Persist OTP
		var fourDigitOtp = PasswordLessTokenHelper.createLoginCredsMapperEntry(token, loginId,siteId);
		var authenticationMethod = currentSitePref.authenticationMethod;
		if (!authenticationMethod) {
			Logger.error('No Authentication Method found');
			res.json({
				error: true,
				message: 'Service configuration error',
				details: { error: 'No Authentication Method found' },
			});
			return next();
		}
		authenticationMethod = authenticationMethod.toString().toLowerCase().trim();

		if (authenticationMethod === 'sms') {
			if (phoneNumberRegex.test(loginId)) {
				definitionKey = currentSitePref.MCSMSDefinitionKey;
				apiBody = {
					ContactKey: loginId,
					EventDefinitionKey: definitionKey,
					Data: {
						Locale: finalLocale,
						Phone: loginId,
						OTP: fourDigitOtp,
						ContactKey: loginId,
					},
				};
			} else {
				Logger.error('LoginId is not Phone Number: {0}', loginId);
			}
		} else if (authenticationMethod === 'email') {
			if (emailRegex.test(loginId)) {
				definitionKey = currentSitePref.MCEmailDefinitionKey;
				apiBody = {
					ContactKey: loginId,
					EventDefinitionKey: definitionKey,
					Data: {
						EmailAddress: loginId,
						OTP: fourDigitOtp,
					},
				};
			} else {
				Logger.error('LoginId is not Email: {0}', loginId);
			}
		}

		if (!clientId || !clientSecret) {
			Logger.error('No Marketing Cloud clientId or clientSecret');
			res.json({
				error: true,
				message: 'Service configuration error',
				details: { error: 'Marketing Cloud credentials not found' },
			});
			return next();
		}

		var authResult = marketingAuthService.marketingAuthService.call({
			clientId: clientId,
			clientSecret: clientSecret,
		});

		if (!authResult.ok) {
			Logger.error('Marketing Cloud Auth Error: ' + JSON.stringify(authResult));
			res.json({
				error: true,
				message: 'Authentication failed',
				details: {
					error: 'Failed to authenticate with Marketing Cloud',
					statusCode: authResult.status,
					errorMessage: authResult.errorMessage,
				},
			});
			return next();
		}

		var accessToken = authResult.object;
		var sendCodeResult = marketingEmailService.marketingEmailService.call({
			accessToken: accessToken,
			body: apiBody,
		});

		if (!sendCodeResult.ok) {
			Logger.error('Marketing Cloud Send Mail/SMS Error: ' + JSON.stringify(sendCodeResult));
			res.json({
				error: true,
				message: 'Mail/SMS not Sent',
				details: {
					error: 'Failed to Send Mail or SMS',
					statusCode: authResult.status,
					errorMessage: authResult.errorMessage,
				},
			});
			return next();
		}

		res.setStatusCode(200);
		res.json({
			message: 'Success!',
		});
	} catch (error) {
		Logger.error('Passwordless Error: ', JSON.stringify(error));
		res.setStatusCode(500);
		res.json({
			error: true,
			message: 'Internal Server Error.',
		});
		return next();
	}

	next();
});

module.exports = server.exports();

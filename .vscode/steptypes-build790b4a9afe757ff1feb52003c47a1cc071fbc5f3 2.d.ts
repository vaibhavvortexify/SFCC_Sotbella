
declare global {

		interface JobExecutionParameters {
			/** Step type to import Inventory from Unicommerce 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#5) */
			'custom.importInventoryFromUnicom': Readonly<{
				/** Fetch Inventory updates in last N minutes. Default is 30 minutes. */
				'lastNMinutes'?: number,
				/** Use semicolon to separate multiple Inventory IDs to be fetched. Leave blank to fetch all inventories. Eg., sotbella-eu;sotbella-uk;sotbella-in;sotbella-us;sotbella-uae */
				'InventoryIds'?: string,
				/** Path to the XML file for inventory. default is 'inventory/' folder in the root directory. */
				'XMLFilePath'?: string,
				/** Name of the XML file for inventory. Default is 'sotbella_inventory.xml'. */
				'XMLFileName'?: string}>;
			/** Step type to fetch and update order and orderLineItem statuses from Unicommerce 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#67) */
			'custom.GetUnicommerceOrderStatus': Readonly<{
				/** Fetch Order updates in last N minutes. Default is 30 minutes. */
				'lastNMinutes'?: number}>;
			/** Exports a product catalog feed CSV and uploads it to SFMC SFTP. 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#105) */
			'custom.ExportProductFeedSFMC': Readonly<{
				/** The remote folder on the SFTP server. */
				'TargetFolder': string,
				/** The base URL for product links. E.g., 'https://sotbella.com/product/' */
				'BaseProductUrl': string}>;
			/** Exports site-specific product data and appends to a shared international CSV. 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#147) */
			'custom.ExportInternationalProductFeedSFMC': Readonly<{
				/** The remote folder on the SFTP server. */
				'TargetFolder': string,
				/** Set to true for the first site in the sequence to delete existing files from previous runs. */
				'IsFirstSite'?: boolean,
				/** Set to true for the last site in the sequence to trigger the SFTP upload. */
				'IsLastSite'?: boolean,
				/** The base URL for product links. E.g., 'https://sotbella.ae/product/' */
				'BaseProductUrl': string}>;
			/** Exports localized product attributes (names, descriptions) into a single shared CSV. 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#201) */
			'custom.ExportLocalizedProductFeedSFMC': Readonly<{
				/**  */
				'TargetFolder': string,
				/** Check for the first site (e.g., US) to delete old files. */
				'IsFirstSite'?: boolean,
				/** Check for the last site (e.g., UAE) to trigger SFTP upload. */
				'IsLastSite'?: boolean,
				/** The base URL for product links. E.g., 'https://sotbella.ae/product/' */
				'BaseProductUrl': string}>;
			/** Step type to update Discount Percentage of all Products 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#241) */
			'custom.CalculateProductDiscounts': Readonly<{}>;
			/** Step type to update orders status of as per Stripe Success 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#267) */
			'custom.CheckStripeOrdersStatus': Readonly<{}>;
			/** Step type to handle Order exports to Unicommerce and return/exchange flow 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#293) */
			'custom.orderExports': Readonly<{}>;
			/** Sends review reminder emails to customers for completed orders after a configured number of days. 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#316) */
			'custom.sendReviewReminders': Readonly<{
				/** The number of days ago to check delivered products for sending review reminders. */
				'reviewReminderThreshold': number}>;
			/** Exports a list of unverified customers modified more than X hours ago to src/UnverifiedCustomers/unverifiedCustomers.xml with mode='delete'. 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#348) */
			'custom.deleteUnverifiedCustomers': Readonly<{
				/** Delete customers not modified within this many hours (e.g., 24). */
				'hoursThreshold': number}>;
			/** Deletes walletTransaction custom objects that have not been modified in the last 24 hours. 
			 * @source [definition](file:///Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/steptypes.json#381) */
			'custom.deleteWalletTransactions': Readonly<{
				/** The number of hours to look back. Transactions older than this (based on lastModified) will be deleted. Default is 24. */
				'hoursToKeep'?: number}>;
		}



}
	export {};

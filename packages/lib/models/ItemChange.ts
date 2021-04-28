import BaseModel, { ModelType } from '../BaseModel';
import shim from '../shim';
import eventManager from '../eventManager';
const Mutex = require('async-mutex').Mutex;

export default class ItemChange extends BaseModel {

	private static addChangeMutex_: any = new Mutex();
	private static saveCalls_: any[] = [];

	public static TYPE_CREATE = 1;
	public static TYPE_UPDATE = 2;
	public static TYPE_DELETE = 3;

	public static SOURCE_UNSPECIFIED = 1;
	public static SOURCE_SYNC = 2;
	public static SOURCE_DECRYPTION = 2; // CAREFUL - SAME ID AS SOURCE_SYNC!

	static tableName() {
		return 'item_changes';
	}

	static modelType() {
		return BaseModel.TYPE_ITEM_CHANGE;
	}

	static async add(itemType: ModelType, itemId: string, type: number, changeSource: any = null, beforeChangeItemJson: string = null) {
		if (changeSource === null) changeSource = ItemChange.SOURCE_UNSPECIFIED;
		if (!beforeChangeItemJson) beforeChangeItemJson = '';

		ItemChange.saveCalls_.push(true);

		// Using a mutex so that records can be added to the database in the
		// background, without making the UI wait.
		const release = await ItemChange.addChangeMutex_.acquire();

		try {
			await this.db().transactionExecBatch([
				{
					sql: 'DELETE FROM item_changes WHERE item_id = ?',
					params: [itemId],
				},
				{
					sql: 'INSERT INTO item_changes (item_type, item_id, type, source, created_time, before_change_item) VALUES (?, ?, ?, ?, ?, ?)',
					params: [itemType, itemId, type, changeSource, Date.now(), beforeChangeItemJson],
				},
			]);
		} finally {
			release();
			ItemChange.saveCalls_.pop();

			eventManager.emit('itemChange', {
				itemType: itemType,
				itemId: itemId,
				eventType: type,
			});
		}
	}

	static async lastChangeId() {
		const row = await this.db().selectOne('SELECT max(id) as max_id FROM item_changes');
		return row && row.max_id ? row.max_id : 0;
	}

	// Because item changes are recorded in the background, this function
	// can be used for synchronous code, in particular when unit testing.
	static async waitForAllSaved() {
		return new Promise((resolve) => {
			const iid = shim.setInterval(() => {
				if (!ItemChange.saveCalls_.length) {
					shim.clearInterval(iid);
					resolve(null);
				}
			}, 100);
		});
	}

	static async deleteOldChanges(lowestChangeId: number) {
		if (!lowestChangeId) return;
		return this.db().exec('DELETE FROM item_changes WHERE id <= ?', [lowestChangeId]);
	}
}

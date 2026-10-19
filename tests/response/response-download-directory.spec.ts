import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '../../playwright';
import { clickResponseAction, closeAllCollections, createCollection, createRequest, sendRequest } from '../utils/page/actions';

test('response downloads remember the last successful folder across requests', async ({ page, electronApp, createTmpDir }) => {
  const downloadDirectory = await createTmpDir('response-downloads');
  const filePaths = ['first.txt', 'second.txt'].map((name) => path.join(downloadDirectory, name));
  const collectionName = 'response-download-directory';

  const originalDialog = await electronApp.evaluateHandle(({ dialog }) => dialog.showSaveDialog);
  await electronApp.evaluate(({ dialog }, paths) => {
    const pendingPaths = [...paths];
    (dialog as any).__responseSaveDefaults = [];
    dialog.showSaveDialog = async (_window, options) => {
      (dialog as any).__responseSaveDefaults.push(options.defaultPath);
      return { canceled: false, filePath: pendingPaths.shift() };
    };
  }, filePaths);

  try {
    await test.step('Save a response to a chosen folder', async () => {
      await createCollection(page, collectionName, await createTmpDir('response-collection'));
      await createRequest(page, 'first-request', collectionName, { url: 'http://localhost:8081/ping' });
      await sendRequest(page, 200);
      await clickResponseAction(page, 'response-download-btn');
      await expect.poll(() => fs.existsSync(filePaths[0])).toBe(true);
      expect(fs.readFileSync(filePaths[0], 'utf8')).toBe('pong');
    });

    await test.step('Save another request in the remembered folder', async () => {
      await createRequest(page, 'second-request', collectionName, { url: 'http://localhost:8081/ping' });
      await sendRequest(page, 200);
      await clickResponseAction(page, 'response-download-btn');
      await expect.poll(() => fs.existsSync(filePaths[1])).toBe(true);
      expect(fs.readFileSync(filePaths[1], 'utf8')).toBe('pong');
      const suggestedPaths = await electronApp.evaluate(({ dialog }) => (dialog as any).__responseSaveDefaults);
      expect(path.dirname(suggestedPaths[1])).toBe(downloadDirectory);
    });
  } finally {
    await electronApp.evaluate(({ dialog }, original) => {
      dialog.showSaveDialog = original;
      delete (dialog as any).__responseSaveDefaults;
    }, originalDialog);
    await originalDialog.dispose();
    await closeAllCollections(page);
  }
});

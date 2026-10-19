const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

jest.mock('electron', () => ({
  app: { getPath: jest.fn(), getVersion: () => '1.0.0', on: jest.fn() },
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  dialog: { showSaveDialog: jest.fn() }
}));
jest.mock('../../src/services/sqlite', () => ({ getStatements: jest.fn(), getFiles: jest.fn() }));

const response = { headers: { 'content-type': 'application/json' }, dataBuffer: Buffer.from('{"ok":true}').toString('base64') };

describe('saving response files', () => {
  let directory;
  let dialog;
  let saveResponse;
  let requestPath;

  beforeEach(() => {
    jest.resetModules();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-save-response-'));
    requestPath = path.join(directory, 'collection', 'request.bru');
    const electron = require('electron');
    electron.app.getPath.mockReturnValue(directory);
    dialog = electron.dialog;
    require('../../src/ipc/network')({ webContents: { send: jest.fn() } });
    saveResponse = electron.ipcMain.handle.mock.calls.find(([channel]) => channel === 'renderer:save-response-to-file')[1];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  const save = (handler, pathname, url = 'https://example.com/response.json', body = response) => handler(null, body, url, pathname);

  it('starts the first save in the request folder', async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(save(saveResponse, requestPath)).resolves.toEqual({ success: false, cancelled: true });
    expect(dialog.showSaveDialog.mock.calls[0][1].defaultPath).toBe(path.join(path.dirname(requestPath), 'response.json'));
  });

  it.each(['inline', 'stored'])('remembers the successful %s response save folder while keeping the next filename', async (storage) => {
    const savedPath = path.join(directory, 'saved.json');
    let body = response;
    if (storage === 'stored') {
      require('../../src/services/sqlite').getStatements.mockReturnValue({
        execute: () => ({ response_file_id: 1, body_data: Buffer.from(response.dataBuffer, 'base64') })
      });
      body = { headers: response.headers, storedRequestUid: 'stored-response' };
    }
    dialog.showSaveDialog.mockResolvedValueOnce({ filePath: savedPath }).mockResolvedValueOnce({ canceled: true });
    await expect(save(saveResponse, requestPath, 'https://example.com/response.json', body)).resolves.toEqual({ success: true, filePath: savedPath });
    expect(fs.readFileSync(savedPath, 'utf8')).toBe('{"ok":true}');
    await save(saveResponse, path.join(directory, 'other-collection', 'other.bru'), 'https://example.com/other.json');
    expect(dialog.showSaveDialog.mock.calls[1][1].defaultPath).toBe(path.join(directory, 'other.json'));
  });

  it('keeps the last successful folder when the next save is cancelled', async () => {
    dialog.showSaveDialog.mockResolvedValueOnce({ filePath: path.join(directory, 'saved.json') }).mockResolvedValue({ canceled: true });
    await save(saveResponse, requestPath);
    await save(saveResponse, path.join(directory, 'another', 'request.bru'));
    await save(saveResponse, requestPath);
    expect(dialog.showSaveDialog.mock.calls[2][1].defaultPath).toBe(path.join(directory, 'response.json'));
  });

  it('does not remember a folder when writing the response fails', async () => {
    fs.writeFileSync(path.join(directory, 'blocked'), 'not a directory');
    dialog.showSaveDialog.mockResolvedValueOnce({ filePath: path.join(directory, 'blocked', 'saved.json') }).mockResolvedValueOnce({ canceled: true });
    await expect(save(saveResponse, requestPath)).rejects.toThrow();
    await save(saveResponse, requestPath);
    expect(dialog.showSaveDialog.mock.calls[1][1].defaultPath).toBe(path.join(path.dirname(requestPath), 'response.json'));
  });
});

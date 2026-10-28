/** 目标目录单文件事务写入：失败时撤销流并移除本次新建的空目标文件。 */

import { DirectoryError, ERROR_CODE } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const NOT_FOUND_ERROR_NAME = 'NotFoundError';

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === NOT_FOUND_ERROR_NAME;
}

async function abortWritable(writable: FileSystemWritableFileStream | null, fileName: string): Promise<boolean> {
  if (!writable) return true;
  try {
    await writable.abort();
    return true;
  } catch (error: unknown) {
    logger.error('撤销失败的文件写入流失败', { fileName, error: String(error) });
    return false;
  }
}

async function removeNewFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
): Promise<boolean> {
  try {
    await directory.removeEntry(fileName);
    return true;
  } catch (error: unknown) {
    if (isNotFoundError(error)) return true;
    logger.error('清理失败写入产生的空文件失败', { fileName, error: String(error) });
    return false;
  }
}

/** 写入目标文件；只有 `close()` 成功后才视为提交成功。 */
export async function writeFileContent(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  content: string,
): Promise<void> {
  let existingFile: FileSystemFileHandle | undefined;
  try {
    existingFile = await directory.getFileHandle(fileName);
  } catch (error: unknown) {
    if (!isNotFoundError(error)) throw error;
  }

  const isNewFile = !existingFile;
  let writable: FileSystemWritableFileStream | null = null;
  try {
    const fileHandle = existingFile ?? await directory.getFileHandle(fileName, { create: true });
    writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch (error: unknown) {
    const abortSucceeded = await abortWritable(writable, fileName);
    const removeSucceeded = isNewFile ? await removeNewFile(directory, fileName) : true;
    if (!abortSucceeded || !removeSucceeded) {
      throw new DirectoryError(
        ERROR_CODE.FILE_WRITE_CLEANUP,
        '目标文件写入失败且清理未完成，请检查目标目录中的未完成文件后重试。',
        { fileName, cause: String(error) },
      );
    }
    throw error;
  }
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import vm from "node:vm";
export function mockBackend() {
  const emails: { body: string; htmlBody: string }[] = [];
  const sheets = new Map<string, any>();
  const files = new Map<string, any>();
  const folders = new Map<string, any>();
  const props = new Map([["SPREADSHEET_ID", "sheet-1"]]);
  const fetches: { url: string; options: any }[] = [];
  let upstream: (url: string, options: any) => any = () => { throw new Error("Network unavailable"); };
  let counter = 0,
    locked = false,
    failNextWrite: boolean | string = false;
  const iterator = (values: any[]) => {
    let i = 0;
    return { hasNext: () => i < values.length, next: () => values[i++] };
  };
  function blob(
    data: any,
    mimeType = "application/octet-stream",
    name = "file",
  ) {
    const bytes =
      typeof data === "string" ? [...Buffer.from(data, "utf8")] : [...data];
    return {
      bytes,
      name,
      mimeType,
      getBytes: () => [...bytes],
      getDataAsString: () => Buffer.from(bytes).toString("utf8"),
    };
  }
  function folder(name: string, id = `folder-${++counter}`): any {
    const result: any = {
      id,
      name,
      trashed: false,
      getId: () => id,
      getName: () => name,
      createFolder: (nextName: string) => folder(nextName),
      getFoldersByName: (target: string) =>
        iterator(
          [...folders.values()].filter((value) => value.name === target),
        ),
      getFilesByName: (target: string) =>
        iterator(
          [...files.values()].filter(
            (value) =>
              !value.trashed && value.folderId === id && value.name === target,
          ),
        ),
      createFile: (source: any) => file(source, id),
      setTrashed: (trashed: boolean) => {
        result.trashed = trashed;
      },
    };
    folders.set(id, result);
    return result;
  }
  function file(source: any, folderId: string): any {
    const id = `file-${++counter}`;
    const result: any = {
      id,
      folderId,
      name: source.name,
      mimeType: source.mimeType,
      bytes: source.bytes,
      description: "",
      trashed: false,
      getId: () => id,
      getName: () => result.name,
      getMimeType: () => result.mimeType,
      getBlob: () => blob(result.bytes, result.mimeType, result.name),
      getDescription: () => result.description,
      setDescription: (description: string) => {
        result.description = description;
        return result;
      },
      // Reads the live property so tests can simulate a file moved to another folder.
      getParents: () => iterator([folders.get(result.folderId)]),
      setTrashed: (trashed: boolean) => {
        result.trashed = trashed;
      },
    };
    files.set(id, result);
    return result;
  }
  function sheet(name: string) {
    const rows: any[][] = [];
    const result: any = {
      name,
      rows,
      getName: () => name,
      getLastRow: () => rows.length,
      getMaxRows: () => 10000,
      insertRowsAfter: () => {},
      getDataRange: () => result.getRange(1, 1, Math.max(rows.length, 1), Math.max(...rows.map((row) => row.length), 2)),
      appendRow: (values: any[]) => {
        rows.push([...values]);
      },
      deleteRow: (row: number) => {
        rows.splice(row - 1, 1);
      },
      getRange: (row: number, col: number, height = 1, width = 1) => ({
        getValues: () =>
          Array.from({ length: height }, (_, r) =>
            Array.from(
              { length: width },
              (_, c) => rows[row + r - 1]?.[col + c - 1] ?? "",
            ),
          ),
        getValue: () => rows[row - 1]?.[col - 1] ?? "",
        // Real Sheets only counts rows that still hold content, so dropping
        // the cleared rows models getLastRow() after an import replaces a
        // longer directory with a shorter one.
        clearContent: () => {
          rows.splice(row - 1, height);
        },
        setValues: (values: any[][]) => {
          if (failNextWrite === true || failNextWrite === name) {
            failNextWrite = false;
            throw new Error("Index write unavailable");
          }
          values.forEach((value, r) =>
            value.forEach((entry, c) => {
              if (typeof entry === "string" && entry.length > 50000)
                throw new Error("Sheets cell limit exceeded");
              rows[row + r - 1] ??= [];
              rows[row + r - 1][col + c - 1] = entry;
            }),
          );
        },
      }),
    };
    sheets.set(name, result);
    return result;
  }
  const root = folder("root", "root");
  const spreadsheet = {
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: sheet,
    getId: () => "sheet-1",
  };
  const sandbox: any = {
    UrlFetchApp: { fetch: (url: string, options: any) => { fetches.push({ url, options }); return upstream(url, options); } },
    MailApp: {
      sendEmail: (message: { body: string; htmlBody: string }) =>
        emails.push(message),
    },
    SpreadsheetApp: {
      openById: (id: string) => {
        assert.equal(id, "sheet-1");
        return spreadsheet;
      },
      getActiveSpreadsheet: () => null,
      flush: () => {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => props.get(key) ?? null,
        setProperty: (key: string, value: string) => props.set(key, value),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (locked) return false;
          locked = true;
          return true;
        },
        releaseLock: () => {
          locked = false;
        },
      }),
    },
    DriveApp: {
      getRootFolder: () => root,
      getFileById: (id: string) => {
        const value = files.get(id);
        if (!value || value.trashed) throw new Error("File not found");
        return value;
      },
      getFolderById: (id: string) => {
        const value = folders.get(id);
        if (!value) throw new Error("Folder not found");
        return value;
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (algorithm: string, input: string) => [
        ...createHash(algorithm).update(input).digest(),
      ],
      newBlob: blob,
      getUuid: randomUUID,
      base64Encode: (bytes: number[]) => Buffer.from(bytes).toString("base64"),
      base64Decode: (text: string) => [...Buffer.from(text, "base64")],
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text: string) => ({
        text,
        setMimeType() {
          return this;
        },
      }),
    },
    Logger: { log: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    readFileSync(new URL("../../apps-script/Code.gs", import.meta.url), "utf8"),
    sandbox,
  );
  return {
    emails,
    sheets,
    files,
    folders,
    props,
    fetches,
    setUpstream: (handler: typeof upstream) => { upstream = handler; },
    post: (body: any) =>
      JSON.parse(
        sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text,
      ),
    get: (parameter: any) => JSON.parse(sandbox.doGet({ parameter }).text),
    failWrite: (sheetName?: string) => {
      failNextWrite = sheetName ?? true;
    },
    busy: (value: boolean) => {
      locked = value;
    },
    installFetch: () => {
      const original = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = new URL(String(input), "http://test.local");
        const output = init?.body
          ? JSON.parse(
              sandbox.doPost({
                postData: { contents: String(init.body) },
              }).text,
            )
          : JSON.parse(
              sandbox.doGet({
                parameter: Object.fromEntries(url.searchParams),
              }).text,
            );
        return new Response(JSON.stringify(output), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;
      return () => {
        globalThis.fetch = original;
      };
    },
  };
}

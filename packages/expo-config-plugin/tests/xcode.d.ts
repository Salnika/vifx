declare module "xcode" {
  export interface XcodeProjectFile {
    hash: {
      project: {
        objects: Record<string, Record<string, unknown> | undefined>;
      };
    };
    parseSync(): XcodeProjectFile;
    writeSync(): string;
  }

  export function project(filePath: string): XcodeProjectFile;
}

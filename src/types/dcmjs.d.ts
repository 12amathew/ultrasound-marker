declare module 'dcmjs' {
  export const data: {
    DicomDict: new (meta: Record<string, unknown>) => {
      dict: Record<string, unknown>
      write: () => ArrayBuffer
    }
    DicomMessage: {
      readFile: (buffer: ArrayBuffer) => { dict: Record<string, unknown>; meta: Record<string, unknown> }
    }
    DicomMetaDictionary: {
      uid: () => string
      date: () => string
      time: () => string
      naturalizeDataset: (dataset: Record<string, unknown>) => Record<string, unknown>
      denaturalizeDataset: (dataset: Record<string, unknown>) => Record<string, unknown>
    }
    datasetToBuffer: (dataset: Record<string, unknown>) => Buffer
  }
}

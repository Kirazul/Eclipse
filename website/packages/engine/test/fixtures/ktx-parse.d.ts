declare module "three/examples/jsm/libs/ktx-parse.module.js" {
  export const KHR_DF_FLAG_ALPHA_STRAIGHT: number;
  export const KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT: number;
  export const KHR_DF_MODEL_RGBSDA: number;
  export const KHR_DF_PRIMARIES_BT709: number;
  export const KHR_DF_SAMPLE_DATATYPE_LINEAR: number;
  export const KHR_DF_TRANSFER_LINEAR: number;
  export const KHR_DF_VENDORID_KHRONOS: number;
  export const KHR_DF_VERSION: number;
  export const VK_FORMAT_R8G8B8A8_UNORM: number;
  export function createDefaultContainer(): {
    vkFormat: number;
    pixelWidth: number;
    pixelHeight: number;
    pixelDepth: number;
    layerCount: number;
    faceCount: number;
    levelCount: number;
    levels: { levelData: Uint8Array; uncompressedByteLength: number }[];
    dataFormatDescriptor: unknown;
  };
  export function write(container: unknown, options?: { keepWriter?: boolean }): Uint8Array;
}

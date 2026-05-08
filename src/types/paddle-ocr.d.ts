declare module "@paddlejs-models/ocr" {
  export function init(): Promise<void>;

  export function recognize(
    image: HTMLImageElement | HTMLCanvasElement,
    options?: {
      canvas?: HTMLCanvasElement;
      style?: Partial<CanvasRenderingContext2D>;
    },
  ): Promise<{
    text?: string | string[];
    points?: unknown[];
  }>;

  export function detect(image: HTMLImageElement | HTMLCanvasElement): Promise<unknown[]>;
}
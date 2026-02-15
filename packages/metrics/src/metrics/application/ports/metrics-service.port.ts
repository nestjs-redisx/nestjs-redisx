import { IMetricsJson } from '../../../shared/types';

export interface IMetricsService {
  // Counters
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;

  // Histograms
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
  startTimer(name: string, labels?: Record<string, string>): () => number;

  // Gauges
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
  incrementGauge(name: string, labels?: Record<string, string>, value?: number): void;
  decrementGauge(name: string, labels?: Record<string, string>, value?: number): void;

  // Registry
  getMetrics(): Promise<string>;
  getMetricsJson(): Promise<IMetricsJson[]>;

  // Registration
  registerCounter(name: string, help: string, labelNames?: string[]): void;
  registerHistogram(name: string, help: string, labelNames?: string[], buckets?: number[]): void;
  registerGauge(name: string, help: string, labelNames?: string[]): void;
}

// Shared type stubs for cache plugin demo snippets

// Domain entities
export interface User {
  id: string;
  name: string;
  email?: string;
  active?: boolean;
}

export interface Product {
  id: string;
  name: string;
  price?: number;
  category?: string;
}

export interface Post {
  id: string;
  title: string;
  content?: string;
}

export interface Order {
  id: string;
  total: number;
  status?: string;
}

export interface Session {
  id: string;
  userId: string;
  data?: Record<string, unknown>;
}

export interface Category {
  id: string;
  name: string;
}

export interface ConfigValue {
  key: string;
  value: unknown;
}

export interface TenantData {
  id: string;
  data: unknown;
}

export interface PeriodStats {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

// DTOs
export interface UpdateUserDto {
  name?: string;
  email?: string;
}

export type UpdateDto = UpdateUserDto;

export interface UpdateProductDto {
  name?: string;
  price?: number;
}

export interface CreatePostDto {
  title: string;
  content: string;
}

// Repositories (abstract classes for DI compatibility)
export abstract class UserRepository {
  abstract findById(id: string): Promise<User>;
  abstract findOne(id: string): Promise<User>;
  abstract update(id: string, data: UpdateUserDto): Promise<User>;
  abstract delete(id: string): Promise<void>;
}

export abstract class ProductRepository {
  abstract findById(id: string): Promise<Product>;
  abstract findByIds(ids: string[]): Promise<Product[]>;
  abstract update(id: string, data: UpdateProductDto): Promise<Product>;
  abstract findTopSelling(limit: number): Promise<Product[]>;
}

export abstract class PostRepository {
  abstract findMany(params: { skip: number; take: number }): Promise<PaginatedResult<Post>>;
  abstract create(data: CreatePostDto): Promise<Post>;
}

export abstract class OrderRepository {
  abstract findById(id: string): Promise<Order | null>;
  abstract findByPeriod(period: string): Promise<Order[]>;
}

export abstract class ConfigRepository {
  abstract findByKey(key: string): Promise<ConfigValue>;
}

export abstract class DataRepository {
  abstract findOne(id: string): Promise<TenantData>;
}

export abstract class CatalogRepository {
  abstract findAllCategories(): Promise<Category[]>;
}

export abstract class SessionRepository {
  abstract findOne(id: string): Promise<Session>;
  abstract delete(id: string): Promise<void>;
}

// Service stubs (for controller examples that inject services)
export abstract class UserServiceStub {
  abstract findOne(id: string): Promise<User>;
  abstract update(id: string, data: UpdateDto): Promise<User>;
  abstract delete(id: string): Promise<void>;
}

export abstract class ProductServiceStub {
  abstract findTopSelling(limit: number): Promise<Product[]>;
}

// External function stubs (for warmup examples)
export declare function loadAppConfig(): Promise<ConfigValue>;
export declare function loadFeatureFlags(): Promise<ConfigValue>;
export declare function loadCategories(): Promise<Category[]>;

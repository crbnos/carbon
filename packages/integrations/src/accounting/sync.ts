/*
License: MIT
Author: Pontus Abrahamssons
Repository: https://github.com/midday-ai/zuno
*/

import type {
  Account,
  Attachment,
  BulkExport,
  CompanyInfo,
  Customer,
  Expense,
  Invoice,
  Transaction,
  Vendor,
} from "./models";
import type {
  CoreProvider,
  ExportJobStatus,
  ProviderConfig,
  SyncOptions,
} from "./service";

export interface QueueJob {
  id: string;
  provider: string;
  method: string;
  args: any[];
  retry: number;
  maxRetries: number;
  scheduledAt: Date;
  tenantId?: string;
  priority?: "low" | "normal" | "high";
  metadata?: Record<string, any>;
}

export interface ProviderRegistry {
  [key: string]: new (config: ProviderConfig) => CoreProvider;
}

export class ProviderManager {
  private providers: Map<string, CoreProvider> = new Map();
  private registry: ProviderRegistry = {};
  private queue?: any; // Cloudflare Queue - will be typed properly when CF types are available
  private exportJobs: Map<string, ExportJobStatus> = new Map();

  constructor(private env: any) {
    this.queue = env.SYNC_QUEUE;
  }

  // Provider registration
  registerProvider(
    name: string,
    providerClass: new (config: ProviderConfig) => CoreProvider
  ) {
    this.registry[name] = providerClass;
  }

  // Provider initialization
  async initializeProvider(
    name: string,
    config: ProviderConfig
  ): Promise<CoreProvider> {
    const ProviderClass = this.registry[name];
    if (!ProviderClass) {
      throw new Error(`Provider ${name} not registered`);
    }

    const provider = new ProviderClass(config);
    this.providers.set(name, provider);
    return provider;
  }

  getProvider(name: string): CoreProvider | undefined {
    return this.providers.get(name);
  }

  // Queue management
  async enqueueJob(
    job: Omit<QueueJob, "id" | "scheduledAt" | "retry">
  ): Promise<string> {
    const queueJob: QueueJob = {
      ...job,
      id: crypto.randomUUID(),
      scheduledAt: new Date(),
      retry: 0,
    };

    if (this.queue) {
      await this.queue.send(queueJob);
    } else {
      // Fallback to direct execution in development
      await this.processJob(queueJob);
    }

    return queueJob.id;
  }

  async processJob(job: QueueJob): Promise<any> {
    const provider = this.getProvider(job.provider);
    if (!provider) {
      throw new Error(`Provider ${job.provider} not found`);
    }

    try {
      const method = (provider as any)[job.method];
      if (typeof method !== "function") {
        throw new Error(
          `Method ${job.method} not found on provider ${job.provider}`
        );
      }

      const result = await method.apply(provider, job.args);
      return result;
    } catch (error) {
      if (job.retry < job.maxRetries) {
        // Retry with exponential backoff
        const delay = Math.pow(2, job.retry) * 1000;
        const retryJob = {
          ...job,
          retry: job.retry + 1,
          scheduledAt: new Date(Date.now() + delay),
        };

        if (this.queue) {
          await this.queue.send(retryJob, { delaySeconds: delay / 1000 });
        }
      }
      throw error;
    }
  }

  // ======================
  // COMPANY INFO METHODS
  // ======================

  async getCompanyInfo(
    provider: string,
    useQueue = false
  ): Promise<CompanyInfo> {
    if (useQueue) {
      await this.enqueueJob({
        provider,
        method: "getCompanyInfo",
        args: [],
        maxRetries: 3,
      });
      throw new Error("Job queued - use webhook or polling to get result");
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getCompanyInfo();
  }

  // ======================
  // ACCOUNT METHODS
  // ======================

  async getAccounts(
    provider: string,
    options?: SyncOptions,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "getAccounts",
        args: [options],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getAccounts(options);
  }

  async getAccount(
    provider: string,
    id: string,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "getAccount",
        args: [id],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getAccount(id);
  }

  async createAccount(
    provider: string,
    account: Omit<Account, "id" | "createdAt" | "updatedAt">,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "createAccount",
        args: [account],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.createAccount(account);
  }

  // ======================
  // CUSTOMER METHODS
  // ======================

  async getCustomers(
    provider: string,
    options?: SyncOptions,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "getCustomers",
        args: [options],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getCustomers(options);
  }

  async getCustomer(
    provider: string,
    id: string,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "getCustomer",
        args: [id],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getCustomer(id);
  }

  async createCustomer(
    provider: string,
    customer: Omit<Customer, "id" | "createdAt" | "updatedAt">,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "createCustomer",
        args: [customer],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.createCustomer(customer);
  }

  // ======================
  // VENDOR METHODS
  // ======================

  async getVendors(
    provider: string,
    options?: SyncOptions,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "getVendors",
        args: [options],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getVendors(options);
  }

  async createVendor(
    provider: string,
    vendor: Omit<Vendor, "id" | "createdAt" | "updatedAt">,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "createVendor",
        args: [vendor],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.createVendor(vendor);
  }

  // ======================
  // INVOICE METHODS
  // ======================

  async getInvoices(
    provider: string,
    options?: SyncOptions,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "getInvoices",
        args: [options],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getInvoices(options);
  }

  async getInvoice(
    provider: string,
    id: string,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "getInvoice",
        args: [id],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getInvoice(id);
  }

  async createInvoice(
    provider: string,
    invoice: Omit<Invoice, "id" | "createdAt" | "updatedAt">,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "createInvoice",
        args: [invoice],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.createInvoice(invoice);
  }

  // ======================
  // TRANSACTION METHODS
  // ======================

  async getTransactions(
    provider: string,
    options?: SyncOptions,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "getTransactions",
        args: [options],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getTransactions(options);
  }

  async createTransaction(
    provider: string,
    transaction: Omit<Transaction, "id" | "createdAt" | "updatedAt">,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "createTransaction",
        args: [transaction],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.createTransaction(transaction);
  }

  // ======================
  // EXPENSE METHODS
  // ======================

  async getExpenses(
    provider: string,
    options?: SyncOptions,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "getExpenses",
        args: [options],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getExpenses(options);
  }

  async createExpense(
    provider: string,
    expense: Omit<Expense, "id" | "createdAt" | "updatedAt">,
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "createExpense",
        args: [expense],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.createExpense(expense);
  }

  // ======================
  // ATTACHMENT METHODS
  // ======================

  async getAttachments(
    entityType: string,
    entityId: string,
    attachmentType?: string,
    useQueue = false
  ): Promise<Attachment[]> {
    // For now, we'll implement a generic attachment retrieval
    // In a real implementation, this would be provider-specific
    return [];
  }

  // Upload attachment method removed - using proxy pattern instead

  // ======================
  // BULK EXPORT METHODS
  // ======================

  async enqueueBulkExport(request: BulkExport): Promise<string> {
    const jobId = crypto.randomUUID();

    // Create export job status
    const exportJob: ExportJobStatus = {
      id: jobId,
      status: "pending",
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.exportJobs.set(jobId, exportJob);

    // Queue the export job
    await this.enqueueJob({
      provider: request.provider,
      method: "startBulkExport",
      args: [request],
      maxRetries: 1, // Don't retry bulk exports
      priority: "low", // Bulk exports are low priority
    });

    return jobId;
  }

  async getBulkExportStatus(jobId: string): Promise<ExportJobStatus> {
    const job = this.exportJobs.get(jobId);
    if (!job) {
      throw new Error(`Export job ${jobId} not found`);
    }

    return job;
  }

  async downloadBulkExport(jobId: string): Promise<ReadableStream> {
    const job = this.exportJobs.get(jobId);
    if (!job) {
      throw new Error(`Export job ${jobId} not found`);
    }

    if (job.status !== "completed") {
      throw new Error(`Export job ${jobId} is not completed`);
    }

    // In a real implementation, this would download from storage
    throw new Error("Download not implemented yet");
  }

  // ======================
  // BATCH OPERATIONS
  // ======================

  async batchSync(
    provider: string,
    entityTypes: string[],
    options?: SyncOptions
  ): Promise<{ [entityType: string]: any }> {
    const results: { [entityType: string]: any } = {};

    const jobs = entityTypes.map((entityType) => ({
      provider,
      method: `get${entityType.charAt(0).toUpperCase() + entityType.slice(1)}`,
      args: [options],
      maxRetries: 3,
    }));

    // Execute all jobs in parallel
    const promises = jobs.map((job) => this.enqueueJob(job));
    const jobIds = await Promise.all(promises);

    // For now, return the job IDs
    // In a real implementation, you'd wait for completion or use webhooks
    entityTypes.forEach((entityType, index) => {
      results[entityType] = { jobId: jobIds[index] };
    });

    return results;
  }

  async batchCreate<T>(
    provider: string,
    entityType: string,
    entities: T[],
    useQueue = false
  ): Promise<any> {
    if (useQueue) {
      return this.enqueueJob({
        provider,
        method: "bulkCreate",
        args: [entityType, entities],
        maxRetries: 3,
      });
    }

    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.bulkCreate(entityType, entities);
  }

  // ======================
  // UTILITY METHODS
  // ======================

  async validateProvider(provider: string): Promise<boolean> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      return false;
    }

    try {
      return await providerInstance.validateAuth();
    } catch (error) {
      return false;
    }
  }

  async getProviderCapabilities(provider: string): Promise<string[]> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.getProviderInfo().capabilities;
  }

  async healthCheck(): Promise<{ [provider: string]: boolean }> {
    const results: { [provider: string]: boolean } = {};

    for (const [name, provider] of this.providers.entries()) {
      try {
        results[name] = await provider.validateAuth();
      } catch (error) {
        results[name] = false;
      }
    }

    return results;
  }

  // ======================
  // SEARCH METHODS
  // ======================

  async searchEntities(
    provider: string,
    entityType: string,
    query: string,
    options?: SyncOptions
  ): Promise<any> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.searchEntities(entityType, query, options);
  }

  // ======================
  // WEBHOOK METHODS
  // ======================

  async createWebhook(
    provider: string,
    url: string,
    events: string[]
  ): Promise<{ id: string; secret: string }> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    return providerInstance.createWebhook(url, events);
  }

  async processWebhook(
    provider: string,
    payload: any,
    signature: string
  ): Promise<void> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    // In a real implementation, you'd validate the signature and process the webhook
    await providerInstance.processWebhook(payload);
  }

  // ======================
  // CLEANUP METHODS
  // ======================

  async cleanup(): Promise<void> {
    // Clear expired export jobs
    const now = new Date();
    for (const [jobId, job] of this.exportJobs.entries()) {
      const ageInHours =
        (now.getTime() - job.createdAt.getTime()) / (1000 * 60 * 60);
      if (ageInHours > 24) {
        // Remove jobs older than 24 hours
        this.exportJobs.delete(jobId);
      }
    }

    // Clear provider instances (they'll be recreated as needed)
    this.providers.clear();
  }

  getStats(): {
    providers: number;
    activeExportJobs: number;
    completedExportJobs: number;
    failedExportJobs: number;
  } {
    const exportJobsArray = Array.from(this.exportJobs.values());

    return {
      providers: this.providers.size,
      activeExportJobs: exportJobsArray.filter(
        (job) => job.status === "processing"
      ).length,
      completedExportJobs: exportJobsArray.filter(
        (job) => job.status === "completed"
      ).length,
      failedExportJobs: exportJobsArray.filter((job) => job.status === "failed")
        .length,
    };
  }
}

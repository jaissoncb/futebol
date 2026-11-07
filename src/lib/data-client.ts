import type { FutebolApiServices } from './api/services'

// DEV and PRD use the same API contract; PostgreSQL access stays in Neon Functions.
export type FutebolDataClient = FutebolApiServices

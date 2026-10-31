import { Schema, Types, model } from 'mongoose'
import { SadissPerformanceDocument } from '../types'

export const sadissPerformanceSchema = new Schema<SadissPerformanceDocument>({
  name: { type: String, required: true },
  creator: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  isPublic: { type: Boolean, required: true },
  deleted: Boolean,
  deletedAt: Date,
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' }
})
sadissPerformanceSchema.set('timestamps', true)

/** The performances an account may see: its own and every public one, unless deleted. */
export const visibleTo = (userId: Types.ObjectId | string) => ({
  $or: [{ isPublic: true }, { creator: userId }],
  deleted: { $ne: true }
})

export const SadissPerformance = model<SadissPerformanceDocument>('SadissPerformance', sadissPerformanceSchema)

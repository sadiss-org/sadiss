import { Response, Request } from 'express'
import { isValidObjectId } from 'mongoose'
import { SadissPerformance, visibleTo } from '../models/sadissPerformance'
import { User } from '../models/user'
import { TrackPerformance } from '../models'

// Get all performances that are public or owned by the user
export const getPerformances = async (req: Request, res: Response) => {
  interface PerformanceWithTrackCount {
    _id: string
    name: string
    creator: {
      _id: string
      username: string
    }
    isPublic: boolean
    trackCount?: number
  }

  try {
    const performances = await SadissPerformance.find(visibleTo(req.user!._id), '_id name creator isPublic')
      .populate('creator', 'username')
      .lean<PerformanceWithTrackCount[]>()

    // Get track counts using MongoDB aggregation pipeline
    const performanceIds = performances.map((performance) => performance._id)

    const trackCounts = await TrackPerformance.aggregate([
      {
        $match: { performance: { $in: performanceIds }, deleted: { $ne: true } }
      },
      {
        $group: {
          _id: '$performance',
          count: { $sum: 1 }
        }
      }
    ])

    // Map track counts back to performances
    const trackCountMap = trackCounts.reduce((acc, curr) => {
      acc[curr._id] = curr.count
      return acc
    }, {} as Record<string, number>)

    // Attach the track count to the corresponding performance
    for (const performance of performances) {
      performance.trackCount = trackCountMap[performance._id] || 0
    }

    res.json({ performances })
  } catch (err) {
    res.status(500).json({ Error: 'Failed fetching performances.' })
  }
}

// Get performances owned by requesting user
export const getOwnPerformances = async (req: Request, res: Response) => {
  try {
    const performances = await SadissPerformance.find(
      { creator: req.user?._id, deleted: { $ne: true } },
      '_id name creator isPublic'
    ).populate('creator', 'username')

    res.json({ performances })
  } catch (err) {
    res.status(500).json({ Error: 'Failed fetching performances.' })
  }
}

export const getPerformance = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid performance ID' })
    }

    let performance = await SadissPerformance.findById(req.params.id)

    if (!performance) {
      return res.status(404).json({ error: 'Performance not found' })
    }

    let performanceWithUsername
    const user = await User.findById(performance.creator, 'username').lean()
    performanceWithUsername = {
      _id: performance._id,
      name: performance.name,
      username: user?.username,
      isPublic: performance.isPublic
    }

    res.json({ performance: performanceWithUsername })
  } catch (err) {
    res.status(500).json({ Error: 'Failed fetching performance.' })
  }
}

export const createPerformance = async (req: Request, res: Response) => {
  try {
    const { name, isPublic } = req.body

    if (!name) {
      return res.status(400).json({ error: 'Invalid performance data' })
    }

    // Save new performance to database
    const performance = new SadissPerformance({ name, isPublic: !!isPublic, creator: req.user?._id })
    performance.save((err) => {
      if (err) {
        res.status(500).send(err)
      } else {
        res.status(201).json(performance)
      }
    })
  } catch (error) {
    res.status(500).json({ error: 'Server error' })
  }
}

export const deletePerformance = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid performance ID' })
    }

    const performance = await SadissPerformance.findById(req.params.id)

    if (!performance) {
      return res.status(404).json({ error: 'Performance not found' })
    }

    // Check if user owns performance
    if (performance.creator.toString() !== req.user?._id.toString()) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Soft delete trackperformances
    const trackPerformances = await TrackPerformance.find({ performance: performance._id })
    for (const trackPerformance of trackPerformances) {
      trackPerformance.deleted = true
      trackPerformance.deletedAt = new Date()
      trackPerformance.deletedBy = req.user?._id
      await trackPerformance.save()
    }

    // Soft delete performance
    performance.deleted = true
    performance.deletedAt = new Date()
    performance.deletedBy = req.user?._id
    await performance.save()

    res.status(200).json({ message: 'Performance deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Server error' })
  }
}

export const editPerformance = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid performance ID' })
    }

    const performance = await SadissPerformance.findById(req.params.id)

    if (!performance) {
      return res.status(404).json({ error: 'Performance not found' })
    }

    // Check if user owns performance
    if (performance.creator.toString() !== req.user?._id.toString()) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { name, isPublic } = req.body

    if (name) {
      performance.name = name
    }

    if (isPublic !== undefined) {
      performance.isPublic = isPublic
    }

    await performance.save()

    res.status(200).json({ message: 'Performance updated' })
  } catch (error) {
    res.status(500).json({ error: 'Server error' })
  }
}

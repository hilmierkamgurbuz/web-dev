import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  published: boolean('published').default(false),
  createdAt: timestamp('created_at').defaultNow(),
})

export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull(),
  authorId: integer('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

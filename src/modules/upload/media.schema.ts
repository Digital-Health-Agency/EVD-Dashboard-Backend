import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MediaDocument = HydratedDocument<Media>;

@Schema({ timestamps: true })
export class Media {
  @Prop({ required: true })
  filename!: string;

  @Prop({ required: true })
  originalName!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true })
  size!: number;

  @Prop({ required: true })
  path!: string;

  @Prop()
  uploadedBy?: string;

  @Prop({ type: [String] })
  tags?: string[];
}

export const MediaSchema = SchemaFactory.createForClass(Media);

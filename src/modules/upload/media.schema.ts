export class Media {
  id!: string;
  _id!: string;

  filename!: string;

  originalName!: string;

  mimeType!: string;

  size!: number;

  path!: string;

  uploadedBy?: string;

  tags!: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

export type MediaDocument = Media;

import { IsOptional, IsString } from 'class-validator';

/**
 * Africa's Talking SMS delivery report callback payload.
 * POSTed to our callback URL when delivery status changes.
 */
export class SmsDeliveryCallbackDto {
  @IsOptional()
  @IsString()
  id?: string; // Provider message ID (ATXid_xxx)

  @IsOptional()
  @IsString()
  status?: string; // Success | Failed | Rejected | Submitted | Buffered

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  networkCode?: string;

  @IsOptional()
  @IsString()
  failureReason?: string;
}

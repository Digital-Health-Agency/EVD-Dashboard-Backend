import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { NotificationService } from './notification.service.js';
import { Notification } from './notification.schema.js';
import { Roles } from '../../common/guards/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';

interface AuthenticatedRequest {
  user?: {
    id?: string;
    userId?: string;
  };
}

function currentUserId(req: AuthenticatedRequest): string {
  const id = req.user?.id ?? req.user?.userId;
  if (!id) throw new UnauthorizedException('Login required');
  return id;
}

@Controller('api/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: Partial<Notification>) {
    return this.notificationService.create(body);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.notificationService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }

  @Get('me')
  findMine(@Req() req: AuthenticatedRequest, @Query('unread') unread?: string) {
    return this.notificationService.findByRecipient(
      currentUserId(req),
      unread === 'true',
    );
  }

  @Patch('me/read-all')
  markMineRead(@Req() req: AuthenticatedRequest) {
    return this.notificationService.markAllRead(currentUserId(req));
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  findOne(@Param('id') id: string) {
    return this.notificationService.findOne(id);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string) {
    return this.notificationService.markAsRead(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: Partial<Notification>) {
    return this.notificationService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.notificationService.remove(id);
  }
}

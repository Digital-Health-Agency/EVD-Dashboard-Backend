import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../../common/guards/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { getRequestAppId } from '../../common/app-id.js';
import {
  createUserSchema,
  deactivateUserSchema,
  setPasswordSchema,
  updateMeSchema,
  updateUserSchema,
  type CreateUserDto,
  type DeactivateUserDto,
  type SetPasswordDto,
  type UpdateMeDto,
  type UpdateUserDto,
} from './dto/user-account.dto.js';
import { UserAccountService } from './user-account.service.js';

interface AuthenticatedRequest {
  get(name: string): string | undefined;
  user?: {
    id?: string;
    userId?: string;
    email?: string;
  };
}

function currentUserId(req: AuthenticatedRequest): string {
  const id = req.user?.id ?? req.user?.userId;
  if (!id) throw new UnauthorizedException('Login required');
  return id;
}

@Controller('api/users')
export class UserController {
  constructor(private readonly users: UserAccountService) {}

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.users.findMe(currentUserId(req));
  }

  @Patch('me')
  updateMe(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeDto,
  ) {
    return this.users.updateMe(currentUserId(req), body);
  }

  @Post('me/deactivate')
  deactivateMe(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(deactivateUserSchema))
    body: DeactivateUserDto,
  ) {
    return this.users.deactivate(currentUserId(req), body.reason);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMe(@Req() req: AuthenticatedRequest) {
    return this.users.remove(currentUserId(req));
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.users.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
      status,
    );
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserDto,
  ) {
    return this.users.create(body, getRequestAppId(req));
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserDto,
  ) {
    return this.users.update(id, body);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('admin')
  deactivate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deactivateUserSchema))
    body: DeactivateUserDto,
  ) {
    return this.users.deactivate(id, body.reason);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('admin')
  activate(@Param('id') id: string) {
    return this.users.activate(id);
  }

  @Post(':id/password')
  @UseGuards(RolesGuard)
  @Roles('admin')
  setPassword(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setPasswordSchema)) body: SetPasswordDto,
  ) {
    return this.users.setPassword(id, body.password);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }
}

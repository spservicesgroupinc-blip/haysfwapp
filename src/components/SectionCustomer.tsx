import React from 'react';
import {
  User,
  MapPin,
  Phone,
  Mail,
  Hash,
  Home,
  Briefcase,
  Smartphone,
} from 'lucide-react';
import { CustomerData, RestorationJobData } from '../types/jobData';
import { DOC } from '../services/documentCatalog';
import { SectionPdfActions, type PdfPreviewRequest } from './SectionPdfActions';

interface SectionCustomerProps {
  data: CustomerData;
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onChange: (field: keyof CustomerData, value: string) => void;
}

const INPUT_CLASS =
  'w-full h-10 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-[13px] text-slate-900 ' +
  'placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 transition';

const LABEL_CLASS = 'block text-[12px] font-medium text-slate-600 mb-1.5';

interface FieldProps {
  label: string;
  field: keyof CustomerData;
  value: string;
  placeholder: string;
  icon: React.ComponentType<{ className?: string }>;
  type?: string;
  required?: boolean;
  hint?: string;
  valueClassName?: string;
  onChange: (field: keyof CustomerData, value: string) => void;
}

const Field: React.FC<FieldProps> = ({
  label,
  field,
  value,
  placeholder,
  icon: Icon,
  type = 'text',
  required,
  hint,
  valueClassName,
  onChange,
}) => (
  <div>
    <label htmlFor={`customer-${field}`} className={LABEL_CLASS}>
      {label}
      {required && <span className="text-red-600 ml-0.5">*</span>}
    </label>
    <div className="relative">
      <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
        <Icon className="w-4 h-4" />
      </span>
      <input
        id={`customer-${field}`}
        type={type}
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
        placeholder={placeholder}
        className={`${INPUT_CLASS} ${valueClassName ?? ''}`}
      />
    </div>
    {hint && <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p>}
  </div>
);

export const SectionCustomer: React.FC<SectionCustomerProps> = ({
  data,
  jobData,
  onPreview,
  onChange,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
        <div className="p-2 rounded-lg bg-slate-100 text-slate-500">
          <User className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">Customer &amp; Property</h3>
          <p className="text-[12px] text-slate-500">
            Homeowner identity, mailing address and the damaged property location
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-5">
        <Field
          label="Job number"
          field="jobNumber"
          value={data.jobNumber}
          placeholder="FW-2026-0001"
          icon={Hash}
          required
          valueClassName="font-medium"
          onChange={onChange}
        />
        <Field
          label="Job name"
          field="jobName"
          value={data.jobName}
          placeholder="Kitchen water damage"
          icon={Briefcase}
          onChange={onChange}
        />
        <Field
          label="Customer name"
          field="customerName"
          value={data.customerName}
          placeholder="Property owner's full name"
          icon={User}
          required
          valueClassName="font-medium"
          onChange={onChange}
        />

        <Field
          label="Mailing address"
          field="mailingAddress"
          value={data.mailingAddress}
          placeholder="Street address"
          icon={MapPin}
          onChange={onChange}
        />
        <Field
          label="Mailing city, state, ZIP"
          field="mailingCityStateZip"
          value={data.mailingCityStateZip}
          placeholder="City, State ZIP"
          icon={MapPin}
          onChange={onChange}
        />
        <Field
          label="Loss address"
          field="lossAddress"
          value={data.lossAddress}
          placeholder="Street, City, State ZIP"
          icon={Home}
          required
          onChange={onChange}
        />

        <Field
          label="Loss contact"
          field="lossContact"
          value={data.lossContact}
          placeholder="On-site contact"
          icon={User}
          onChange={onChange}
        />
        <Field
          label="Mobile phone"
          field="mobilePhone"
          value={data.mobilePhone}
          placeholder="1-000-000-0000"
          icon={Smartphone}
          type="tel"
          onChange={onChange}
        />
        <Field
          label="Main phone"
          field="mainPhone"
          value={data.mainPhone}
          placeholder="1-000-000-0000"
          icon={Phone}
          type="tel"
          onChange={onChange}
        />

        <Field
          label="Home phone"
          field="homePhone"
          value={data.homePhone}
          placeholder="1-000-000-0000"
          icon={Phone}
          type="tel"
          onChange={onChange}
        />
        <Field
          label="Email address"
          field="email"
          value={data.email}
          placeholder="name@example.com"
          icon={Mail}
          type="email"
          onChange={onChange}
        />
      </div>

      <SectionPdfActions jobData={jobData} docs={[DOC.welcomeLetter]} onPreview={onPreview} />
    </div>
  );
};
